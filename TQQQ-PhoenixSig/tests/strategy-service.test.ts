import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getStrategyPayloads } from '@/lib/strategy/service';
import type { DailyPricePayload } from '@/lib/data/yahoo';

vi.mock('@/lib/data/cache', () => ({
  readJsonCache: vi.fn(),
  writeJsonCache: vi.fn(),
}));

vi.mock('@/lib/data/yahoo', () => ({
  fetchDailyPrices: vi.fn(),
}));

import { readJsonCache, writeJsonCache } from '@/lib/data/cache';
import { fetchDailyPrices } from '@/lib/data/yahoo';

describe('getStrategyPayloads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.mocked(readJsonCache).mockResolvedValue(null);
    vi.mocked(writeJsonCache).mockResolvedValue();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses the live trading day for the current signal when Yahoo has a newer raw row than the confirmed close set', async () => {
    vi.setSystemTime(new Date('2026-04-01T14:00:00.000Z'));

    const market: DailyPricePayload = {
      key: '2010-04-01-live-open',
      data: {
        TQQQ: [
          { date: '2010-03-31', open: 100, close: 100 },
        ],
        SGOV: [
          { date: '2010-03-31', open: 100, close: 100 },
        ],
      },
      liveData: {
        TQQQ: [
          { date: '2010-03-31', open: 100, close: 100 },
          { date: '2010-04-01', open: 50, close: 50 },
        ],
        SGOV: [
          { date: '2010-03-31', open: 100, close: 100 },
          { date: '2010-04-01', open: 100, close: 100 },
        ],
      },
      isStaleFallback: false,
      nextRetryAtMs: null,
    };

    vi.mocked(fetchDailyPrices).mockResolvedValue(market);

    const result = await getStrategyPayloads();

    expect(result.backtest.latestState.date).toBe('2010-03-31');
    expect(result.current.confirmedCloseDate).toBe('2010-03-31');
    expect(result.current.asOfDate).toBe('2010-04-01');
    expect(result.current.currentRebalanceEvent?.date).toBe('2010-04-01');
    expect(result.current.currentRebalanceEvent?.action).toBe('buy_tqqq');
  });

  it('falls back to the latest confirmed close during the last-close refresh window', async () => {
    vi.setSystemTime(new Date('2026-04-01T21:00:00.000Z'));

    const market: DailyPricePayload = {
      key: '2010-04-01-last-close',
      data: {
        TQQQ: [
          { date: '2010-03-31', open: 100, close: 100 },
        ],
        SGOV: [
          { date: '2010-03-31', open: 100, close: 100 },
        ],
      },
      liveData: {
        TQQQ: [
          { date: '2010-03-31', open: 100, close: 100 },
          { date: '2010-04-01', open: 50, close: 50 },
        ],
        SGOV: [
          { date: '2010-03-31', open: 100, close: 100 },
          { date: '2010-04-01', open: 100, close: 100 },
        ],
      },
      isStaleFallback: false,
      nextRetryAtMs: null,
    };

    vi.mocked(fetchDailyPrices).mockResolvedValue(market);

    const result = await getStrategyPayloads();

    expect(result.current.confirmedCloseDate).toBe('2010-03-31');
    expect(result.current.asOfDate).toBe('2010-03-31');
    expect(result.current.currentRebalanceEvent).toBeNull();
  });
});
