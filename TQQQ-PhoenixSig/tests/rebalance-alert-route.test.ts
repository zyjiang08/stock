import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/jobs/rebalance-alerts/run/route';
import * as store from '@/lib/db/store';
import * as strategyService from '@/lib/strategy/service';
import * as telegramClient from '@/lib/telegram/client';

vi.mock('@/lib/db/store', () => ({
  listActiveSubscribers: vi.fn(),
}));

vi.mock('@/lib/strategy/service', () => ({
  getStrategyPayloads: vi.fn(),
}));

vi.mock('@/lib/telegram/client', () => ({
  sendTelegramMessage: vi.fn(),
}));

describe('rebalance alert route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.JOB_RUNNER_SECRET = 'test-secret';
  });

  it('sends the live-session rebalance event on the actual rebalance date', async () => {
    vi.mocked(strategyService.getStrategyPayloads).mockResolvedValue({
      current: {
        asOfDate: '2026-04-01',
        currentRebalanceEvent: {
          date: '2026-04-01',
          action: 'buy_tqqq',
          intendedAction: 'buy_tqqq',
          tqqqTradeDollars: 1250,
          defensiveTradeDollars: -1250,
          tqqqValue: 10250,
          defensiveValue: 0,
          tqqqWeight: 100,
          defensiveWeight: 0,
          ruleState: {
            athDdActive: false,
            skipSellDaysRemaining: 0,
            skipSellWindowEnds: null,
            floorTriggered: false,
            latestClose: 0,
            trailingAthClose: 0,
            pctFromAth: 0,
            athDdTriggerDate: null,
            athDdTriggerClose: 0,
            athDdTriggerAthClose: 0,
            athDdTriggerAthCloseDate: null,
            athDdTriggerPctOfAth: 0,
          },
          reason: 'Quarterly rebalance executed.',
          defensiveAsset: 'CASH',
        },
      },
      backtest: {
        rebalanceLog: [
          {
            date: '2026-01-02',
            action: 'hold',
            intendedAction: 'hold',
            tqqqTradeDollars: 0,
            defensiveTradeDollars: 0,
            tqqqValue: 10000,
            defensiveValue: 0,
            tqqqWeight: 100,
            defensiveWeight: 0,
            ruleState: {
              athDdActive: false,
              skipSellDaysRemaining: 0,
              skipSellWindowEnds: null,
              floorTriggered: false,
              latestClose: 0,
              trailingAthClose: 0,
              pctFromAth: 0,
              athDdTriggerDate: null,
              athDdTriggerClose: 0,
              athDdTriggerAthClose: 0,
              athDdTriggerAthCloseDate: null,
              athDdTriggerPctOfAth: 0,
            },
            reason: 'No trade.',
            defensiveAsset: 'CASH',
          },
        ],
      },
    } as never);
    vi.mocked(store.listActiveSubscribers).mockResolvedValue([
      {
        chatId: '42',
        active: true,
        subscribedAt: '2026-03-29T00:00:00.000Z',
        unsubscribedAt: null,
      },
    ]);
    vi.mocked(telegramClient.sendTelegramMessage).mockResolvedValue();

    const response = await POST(new Request('http://localhost/api/jobs/rebalance-alerts/run', {
      method: 'POST',
      headers: { 'x-job-key': 'test-secret' },
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.sent).toBe(1);
    expect(body.alertKey).toBe('2026-04-01-buy_tqqq-1250');
    expect(telegramClient.sendTelegramMessage).toHaveBeenCalledWith(
      '42',
      expect.stringContaining('Phoenix Sig Quarterly Rebalance: BUY'),
    );
  });
});
