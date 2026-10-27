import type { Express, Request, Response } from 'express';
import { subscribeChat, unsubscribeChat, resolveConnectToken } from './store.js';
import { sendTelegramMessage } from './client.js';

export function registerWebhookRoute(app: Express): void {
  app.post('/api/telegram/webhook', async (req: Request, res: Response) => {
    try {
      const update = req.body;
      const text: string = update?.message?.text?.trim() ?? '';
      const chatId = update?.message?.chat?.id != null ? String(update.message.chat.id) : null;

      if (!chatId) {
        res.json({ ok: true });
        return;
      }

      if (text.startsWith('/start')) {
        // Extract the deep-link token payload: "/start <token>"
        const parts = text.split(' ');
        const tokenPayload = parts[1]?.trim() ?? '';

        let openId: string | null = null;
        if (tokenPayload && tokenPayload !== 'phoenixsig') {
          // Resolve the one-time token to an openId
          openId = await resolveConnectToken(tokenPayload).catch(() => null);
        }

        await subscribeChat(chatId, openId ?? undefined);

        if (openId) {
          await sendTelegramMessage(chatId, '✅ Connected! Your Telegram is now linked to your PhoenixSig account. You\'ll receive quarterly rebalance alerts. Send /stop to unsubscribe.').catch(() => {});
        } else {
          await sendTelegramMessage(chatId, '✅ You\'re now subscribed to PhoenixSig quarterly rebalance alerts! Send /stop to unsubscribe.').catch(() => {});
        }
      } else if (text.startsWith('/stop')) {
        await unsubscribeChat(chatId);
        await sendTelegramMessage(chatId, '🔕 You\'ve been unsubscribed from PhoenixSig alerts. Send /start to re-subscribe.').catch(() => {});
      }

      res.json({ ok: true });
    } catch (err) {
      console.error('[webhook] Error processing Telegram update:', err);
      res.status(500).json({ ok: false });
    }
  });
}
