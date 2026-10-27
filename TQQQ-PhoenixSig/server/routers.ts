import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { COOKIE_NAME } from '@shared/const';
import { getSessionCookieOptions } from './_core/cookies';
import { ENV } from './_core/env';
import { systemRouter } from './_core/systemRouter';
import { publicProcedure, protectedProcedure, router } from './_core/trpc';
import { getStrategyPayloads } from './strategy/service.js';
import { runRebalanceAlertsJob } from './jobs/rebalance-alerts.js';
import {
  subscribeChat,
  unsubscribeChat,
  getActiveSubscriberForUser,
  disconnectSubscriberForUser,
  createConnectToken,
  getTelegramUpdateCursor,
  setTelegramUpdateCursor,
  resolveConnectToken,
} from './telegram/store.js';
import {
  telegramBotConfigured,
  telegramConnectUrl,
  fetchTelegramUpdates,
  sendTelegramMessage,
} from './telegram/client.js';
import { getDb } from './db.js';

const LOCAL_DEV_CHAT_PREFIX = 'local-dev:';

export const appRouter = router({
  system: systemRouter,

  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  strategy: router({
    dashboard: publicProcedure.query(async () => {
      const { current, backtest, staleMarketData, nextRetryAtMs } = await getStrategyPayloads();
      return { current, backtest, staleMarketData, nextRetryAtMs };
    }),

    current: publicProcedure.query(async () => {
      const { current, staleMarketData, nextRetryAtMs } = await getStrategyPayloads();
      return { current, staleMarketData, nextRetryAtMs };
    }),

    backtest: publicProcedure.query(async () => {
      const { backtest, staleMarketData, nextRetryAtMs } = await getStrategyPayloads();
      return { backtest, staleMarketData, nextRetryAtMs };
    }),
  }),

  telegram: router({
    status: publicProcedure.query(async ({ ctx }) => {
      const botConfigured = telegramBotConfigured();
      let connectUrl: string | null = null;

      if (botConfigured) {
        const baseUrl = await telegramConnectUrl();
        if (baseUrl) {
          if (ctx.user) {
            try {
              // Create a one-time token so the Telegram webhook can link chatId to openId.
              const token = await createConnectToken(ctx.user.openId);
              connectUrl = `https://t.me/${baseUrl.split('t.me/')[1]?.split('?')[0]}?start=${token}`;
            } catch (error) {
              console.warn('[Telegram] Connect token unavailable, falling back to plain bot link:', error);
              connectUrl = baseUrl;
            }
          } else {
            connectUrl = baseUrl;
          }
        }
      }

      let subscriber = null;
      if (ctx.user) {
        try {
          subscriber = await getActiveSubscriberForUser(ctx.user.openId);
        } catch (error) {
          console.warn('[Telegram] Unable to read subscriber status:', error);
          subscriber = null;
        }
      }

      return {
        botConfigured,
        connectUrl,
        connected: Boolean(subscriber),
        chatId: subscriber?.chatId ?? null,
      };
    }),

    sync: protectedProcedure.mutation(async ({ ctx }) => {
      if (!telegramBotConfigured()) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Telegram bot not configured.' });
      }

      const db = await getDb();
      if (!db) {
        if (!ENV.isProduction && ENV.authBypassLocal) {
          const subscriber = await subscribeChat(`${LOCAL_DEV_CHAT_PREFIX}${ctx.user.openId}`, ctx.user.openId);
          return {
            connected: true,
            chatId: subscriber.chatId,
            processed: 1,
            simulated: true,
          };
        }

        const currentCursor = await getTelegramUpdateCursor();
        let processed = 0;
        let maxCursor = currentCursor;

        try {
          const updates = await fetchTelegramUpdates(currentCursor > 0 ? currentCursor + 1 : undefined);

          for (const update of updates) {
            if (typeof update.update_id === 'number' && update.update_id > maxCursor) {
              maxCursor = update.update_id;
            }

            const chatId = update.message?.chat?.id != null ? String(update.message.chat.id) : null;
            const text = update.message?.text?.trim() ?? '';
            if (!chatId || !text) continue;

            if (text.startsWith('/stop')) {
              await unsubscribeChat(chatId);
              processed += 1;
              continue;
            }

            if (!text.startsWith('/start')) continue;

            const tokenPayload = text.split(' ')[1]?.trim() ?? '';
            let openId = ctx.user.openId;

            if (tokenPayload && tokenPayload !== 'phoenixsig') {
              openId = (await resolveConnectToken(tokenPayload).catch(() => null)) ?? ctx.user.openId;
            }

            await subscribeChat(chatId, openId);
            processed += 1;
          }
        } catch (error) {
          const rawMessage = error instanceof Error ? error.message : 'Telegram sync failed.';
          const message = rawMessage.includes('409') && rawMessage.toLowerCase().includes('webhook')
            ? 'This bot is already connected to a Telegram webhook on the hosted site, so localhost cannot poll updates. Use the deployed site, a separate dev bot token, or temporarily disable the webhook to test local Telegram linking.'
            : rawMessage;
          throw new TRPCError({ code: 'BAD_GATEWAY', message });
        }

        if (maxCursor > currentCursor) {
          await setTelegramUpdateCursor(maxCursor);
        }

        const subscriber = await getActiveSubscriberForUser(ctx.user.openId);
        return {
          connected: Boolean(subscriber),
          chatId: subscriber?.chatId ?? null,
          processed,
        };
      }

      // In webhook + database mode, /start writes directly to the subscriber store, so sync just rechecks it.
      const subscriber = await getActiveSubscriberForUser(ctx.user.openId);
      return {
        connected: Boolean(subscriber),
        chatId: subscriber?.chatId ?? null,
        processed: 0,
      };
    }),

    test: protectedProcedure.mutation(async ({ ctx }) => {
      const subscriber = await getActiveSubscriberForUser(ctx.user.openId);
      if (!subscriber) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'No connected Telegram account found.' });
      }

      if (subscriber.chatId.startsWith(LOCAL_DEV_CHAT_PREFIX)) {
        return { ok: true, simulated: true };
      }

      await sendTelegramMessage(
        subscriber.chatId,
        `✅ PhoenixSig test message — your Telegram alerts are working! (${new Date().toISOString()})`,
      );

      return { ok: true };
    }),

    disconnect: protectedProcedure.mutation(async ({ ctx }) => {
      const subscriber = await disconnectSubscriberForUser(ctx.user.openId);
      if (!subscriber) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'No connected Telegram account found to disconnect.' });
      }

      return { ok: true, chatId: subscriber.chatId };
    }),

    subscribeChat: protectedProcedure
      .input(z.object({ chatId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const subscriber = await subscribeChat(input.chatId, ctx.user.openId);
        return { ok: true, subscriber };
      }),

    unsubscribeChat: protectedProcedure
      .input(z.object({ chatId: z.string() }))
      .mutation(async ({ input }) => {
        const subscriber = await unsubscribeChat(input.chatId);
        return { ok: true, subscriber };
      }),
  }),

  jobs: router({
    rebalanceAlerts: publicProcedure
      .input(z.object({ jobKey: z.string() }))
      .mutation(async ({ input }) => {
        const result = await runRebalanceAlertsJob(input.jobKey);

        if (result.status === 401) {
          throw new TRPCError({
            code: 'UNAUTHORIZED',
            message: result.body.ok ? 'Invalid job key.' : result.body.error,
          });
        }

        if (result.status >= 500) {
          throw new TRPCError({
            code: 'BAD_GATEWAY',
            message: result.body.ok ? 'Rebalance alert job failed.' : result.body.error,
          });
        }

        return result.body;
      }),
  }),
});

export type AppRouter = typeof appRouter;
