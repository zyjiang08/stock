import { NextResponse } from 'next/server';
import { getLatestActiveSubscriber } from '@/lib/db/store';
import { createAuthRequiredResponse, getRequestAuthUser } from '@/lib/auth/request';
import { sendTelegramMessage, telegramBotConfigured } from '@/lib/telegram/client';

export async function POST(request: Request) {
  if (!getRequestAuthUser(request)) {
    return createAuthRequiredResponse();
  }

  if (!telegramBotConfigured()) {
    return NextResponse.json({ ok: false, error: 'Missing TELEGRAM_BOT_TOKEN in .env.local.' }, { status: 400 });
  }

  const subscriber = await getLatestActiveSubscriber();
  if (!subscriber) {
    return NextResponse.json(
      { ok: false, error: 'No connected Telegram account found yet. Use Connect Telegram and send /start first.' },
      { status: 400 },
    );
  }

  const text = `PhoenixSig Telegram health check OK at ${new Date().toISOString()}`;

  try {
    await sendTelegramMessage(subscriber.chatId, text);
    return NextResponse.json({ ok: true, chatId: subscriber.chatId });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Telegram test failed.';
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
