import { NextResponse } from 'next/server';
import { subscribeChat, unsubscribeChat } from '@/lib/db/store';
import { sendTelegramMessage, telegramBotConfigured } from '@/lib/telegram/client';

const sendTelegramAck = async (chatId: string, text: string): Promise<void> => {
  if (!telegramBotConfigured()) return;

  try {
    await sendTelegramMessage(chatId, text);
  } catch {
    // Keep webhook handling resilient even if Telegram sendMessage fails.
  }
};

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: true, ignored: true, reason: 'invalid-json' });
  }

  const message = (
    body &&
    typeof body === 'object' &&
    'message' in body &&
    body.message &&
    typeof body.message === 'object'
  ) ? body.message : undefined;
  const text = message && 'text' in message ? message.text : undefined;
  const chat = message && 'chat' in message ? message.chat : undefined;
  const chatId =
    chat && typeof chat === 'object' && 'id' in chat && (typeof chat.id === 'number' || typeof chat.id === 'string')
      ? String(chat.id)
      : undefined;

  if (typeof text !== 'string' || !chatId) return NextResponse.json({ ok: true, ignored: true });

  if (text.startsWith('/start')) {
    await subscribeChat(chatId);
    await sendTelegramAck(chatId, 'PhoenixSig connected. You can now use the site controls to send a test message or disconnect this bot.');
    return NextResponse.json({ ok: true, status: 'subscribed' });
  }

  if (text.startsWith('/stop')) {
    await unsubscribeChat(chatId);
    await sendTelegramAck(chatId, 'PhoenixSig disconnected. Send /start any time to reconnect.');
    return NextResponse.json({ ok: true, status: 'unsubscribed' });
  }

  return NextResponse.json({ ok: true, ignored: true });
}
