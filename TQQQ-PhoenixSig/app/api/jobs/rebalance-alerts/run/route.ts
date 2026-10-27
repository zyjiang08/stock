import { NextResponse } from 'next/server';
import { listActiveSubscribers } from '@/lib/db/store';
import { getStrategyPayloads } from '@/lib/strategy/service';
import { sendTelegramMessage } from '@/lib/telegram/client';

const unauthorised = () => NextResponse.json({ ok: false, error: 'Unauthorised' }, { status: 401 });

const formatAlertTitleAction = (action: string): string => {
  if (action === 'buy_tqqq') return 'BUY';
  if (action === 'sell_tqqq') return 'SELL';
  return 'HOLD';
};

const formatAlertAction = (action: string, intendedAction: string | undefined): string => {
  if (action === 'buy_tqqq') return 'BUY TQQQ';
  if (action === 'sell_tqqq') return 'SELL TQQQ';
  if (intendedAction === 'sell_tqqq') return 'HOLD ( ATTEMPTED SELL BLOCKED )';
  if (intendedAction === 'buy_tqqq') return 'HOLD ( ATTEMPTED BUY BLOCKED )';
  return 'HOLD ( NO TRADE NEEDED )';
};

export async function POST(req: Request) {
  const key = req.headers.get('x-job-key')?.trim();
  const secret = process.env.JOB_RUNNER_SECRET?.trim();
  if (!secret || key !== secret) return unauthorised();

  const { backtest, current } = await getStrategyPayloads();
  const event = current.currentRebalanceEvent ?? backtest.rebalanceLog[backtest.rebalanceLog.length - 1];
  const context = {
    evaluatedAsOfDate: current.asOfDate,
    latestRebalanceDate: event?.date ?? null,
    recipientChatIds: [] as string[],
  };

  if (!event) return NextResponse.json({ ok: true, skipped: 'No rebalance event.', ...context });
  if (event.date !== current.asOfDate) {
    return NextResponse.json({
      ok: true,
      skipped: `Latest rebalance event is not due for today ( latest rebalance ${event.date}, evaluated as-of ${current.asOfDate} ).`,
      ...context,
    });
  }

  const alertKey = `${event.date}-${event.action}-${event.tqqqTradeDollars}`;
  const titleAction = formatAlertTitleAction(event.action);
  const actionLabel = formatAlertAction(event.action, event.intendedAction);

  const subscribers = await listActiveSubscribers();
  const recipientChatIds = subscribers.map((subscriber) => subscriber.chatId);
  if (subscribers.length === 0) {
    return NextResponse.json({ ok: true, skipped: 'No active subscribers.', ...context });
  }

  const message = [
    `Phoenix Sig Quarterly Rebalance: ${titleAction}`,
    `Date: ${event.date}`,
    `Action: ${actionLabel}`,
    `TQQQ trade: $${event.tqqqTradeDollars.toFixed(2)}`,
    `Defensive trade: $${event.defensiveTradeDollars.toFixed(2)}`,
    `Reason: ${event.reason}`,
  ].join('\n');

  const sendResults = await Promise.allSettled(subscribers.map((s) => sendTelegramMessage(s.chatId, message)));
  const failed = sendResults
    .map((result, idx) => (result.status === 'rejected' ? subscribers[idx].chatId : null))
    .filter((chatId): chatId is string => chatId !== null);

  if (failed.length === subscribers.length) {
    return NextResponse.json(
      { ok: false, error: 'Failed to send rebalance alert to all subscribers.', failed, alertKey, ...context, recipientChatIds },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    sent: subscribers.length - failed.length,
    failed,
    alertKey,
    ...context,
    recipientChatIds,
  });
}
