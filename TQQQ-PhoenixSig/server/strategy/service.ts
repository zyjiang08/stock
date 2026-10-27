import { fetchDailyPrices } from '../data/yahoo.js';
import { currentSingaporeRefreshPhase } from '../time/singapore-refresh.js';
import { makeCurrentSnapshot, makeLiveCurrentSnapshot, runBacktest } from './engine.js';
import type { StrategyBacktest, StrategySnapshot } from './types.js';
import { getDb } from '../db.js';
import { strategyCache } from '../../drizzle/schema.js';
import { eq } from 'drizzle-orm';

type StrategyCachePayload = {
  key: string;
  backtest: StrategyBacktest;
  current: StrategySnapshot;
};

const STRATEGY_CACHE_KEY = 'strategy-v27';

const getLatestLiveDate = (
  confirmed: Array<{ date: string }>,
  live: Array<{ date: string }>,
): string | null => {
  const confirmedDate = confirmed[confirmed.length - 1]?.date ?? null;
  const liveDate = live[live.length - 1]?.date ?? null;
  if (!confirmedDate || !liveDate || liveDate <= confirmedDate) return null;
  return liveDate;
};

async function readStrategyCache(): Promise<StrategyCachePayload | null> {
  try {
    const db = await getDb();
    if (!db) return null;
    const rows = await db.select().from(strategyCache).where(eq(strategyCache.cacheKey, STRATEGY_CACHE_KEY)).limit(1);
    if (!rows[0]) return null;
    return JSON.parse(rows[0].payload) as StrategyCachePayload;
  } catch {
    return null;
  }
}

async function writeStrategyCache(data: StrategyCachePayload): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    const payload = JSON.stringify(data);
    await db
      .insert(strategyCache)
      .values({ cacheKey: STRATEGY_CACHE_KEY, payload })
      .onDuplicateKeyUpdate({ set: { payload } });
  } catch (err) {
    console.warn('[strategy] Failed to write cache:', err);
  }
}

export const getStrategyPayloads = async (): Promise<{
  backtest: StrategyBacktest;
  current: StrategySnapshot;
  staleMarketData: boolean;
  nextRetryAtMs: number | null;
}> => {
  const cached = await readStrategyCache();
  const market = await fetchDailyPrices();
  const key = `${market.key}-v27`;

  if (cached?.key === key) {
    return {
      backtest: cached.backtest,
      current: {
        ...cached.current,
        marketTimestamp: Date.now(),
      },
      staleMarketData: market.isStaleFallback,
      nextRetryAtMs: market.nextRetryAtMs,
    };
  }

  const backtest: StrategyBacktest = runBacktest(market.data.TQQQ, market.data.SGOV);
  const refreshPhase = currentSingaporeRefreshPhase();
  const liveDate = getLatestLiveDate(market.data.TQQQ, market.liveData.TQQQ);
  const liveTqqqPoint = liveDate ? market.liveData.TQQQ[market.liveData.TQQQ.length - 1] : null;
  const liveSgovCandidate = liveDate ? market.liveData.SGOV[market.liveData.SGOV.length - 1] : null;
  const liveSgovPoint = liveSgovCandidate?.date === liveDate ? liveSgovCandidate : null;
  const current = refreshPhase === 'live-open' && liveTqqqPoint
    ? makeLiveCurrentSnapshot(backtest, market.data.TQQQ, market.data.SGOV, liveTqqqPoint, liveSgovPoint)
    : makeCurrentSnapshot(backtest);
  await writeStrategyCache({ key, backtest, current });

  return {
    backtest,
    current,
    staleMarketData: market.isStaleFallback,
    nextRetryAtMs: market.nextRetryAtMs,
  };
};
