import { NextResponse } from 'next/server';
import { disconnectLatestActiveSubscriber } from '@/lib/db/store';
import { createAuthRequiredResponse, getRequestAuthUser } from '@/lib/auth/request';

export async function POST(request: Request) {
  if (!getRequestAuthUser(request)) {
    return createAuthRequiredResponse();
  }

  const subscriber = await disconnectLatestActiveSubscriber();
  if (!subscriber) {
    return NextResponse.json(
      { ok: false, error: 'No connected Telegram account found to disconnect.' },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true, chatId: subscriber.chatId });
}
