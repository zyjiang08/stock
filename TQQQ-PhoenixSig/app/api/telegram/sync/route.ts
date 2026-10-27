import { NextResponse } from 'next/server';
import { getLatestActiveSubscriber, getTelegramUpdateCursor, setTelegramUpdateCursor, subscribeChat, unsubscribeChat } from '@/lib/db/store';
import { createAuthRequiredResponse, getRequestAuthUser } from '@/lib/auth/request';
import { fetchTelegramUpdates, telegramBotConfigured } from '@/lib/telegram/client';

export async function POST(request: Request) {
  if (!getRequestAuthUser(request)) {
    return createAuthRequiredResponse();
  }

  if (!telegramBotConfigured()) {
    return NextResponse.json({ ok: false, error: 'Missing TELEGRAM_BOT_TOKEN in .env.local.' }, { status: 400 });
  }

  try {
    const cursor = await getTelegramUpdateCursor();
    const updates = await fetchTelegramUpdates(cursor > 0 ? cursor + 1 : undefined);
    const latestUpdateId = updates.reduce<number>((max, update) => Math.max(max, update.update_id), cursor);
    if (latestUpdateId > cursor) {
      await setTelegramUpdateCursor(latestUpdateId);
    }

    const messageUpdates = updates
      .filter((update) => typeof update?.message?.text === 'string' && update?.message?.chat?.id != null)
      .sort((left, right) => left.update_id - right.update_id);

    let processed = 0;
    for (const update of messageUpdates) {
      const text = update.message?.text?.trim() ?? '';
      const chatId = String(update.message?.chat?.id ?? '');
      if (!chatId) continue;

      if (text.startsWith('/start')) {
        await subscribeChat(chatId);
        processed += 1;
      } else if (text.startsWith('/stop')) {
        await unsubscribeChat(chatId);
        processed += 1;
      }
    }

    const activeSubscriber = await getLatestActiveSubscriber();
    if (activeSubscriber) {
      return NextResponse.json({
        ok: true,
        connected: true,
        chatId: activeSubscriber.chatId,
        processed,
      });
    }

    if (processed > 0) {
      return NextResponse.json({
        ok: true,
        connected: false,
        processed,
        message: 'Telegram updates were synced, but the latest command disconnected the bot.',
      });
    }

    return NextResponse.json({
      ok: true,
      connected: false,
      processed: 0,
      message: 'No new Telegram connection update was found.',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Telegram sync failed.';
    if (/webhook/i.test(message)) {
      return NextResponse.json(
        {
          ok: false,
          error: 'Telegram is currently using webhook mode, so localhost cannot pull updates. Point the webhook at this app or disable the webhook to test locally.',
        },
        { status: 409 },
      );
    }

    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
