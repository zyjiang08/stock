import { readJsonCache, writeJsonCache } from '@/lib/data/cache';
import { fetchDailyPrices } from '@/lib/data/yahoo';
import { currentSingaporeRefreshPhase } from '@/lib/time/singapore-refresh';
import { makeCurrentSnapshot, makeLiveCurrentSnapshot, runBacktest } from './engine';
import { StrategyBacktest, StrategySnapshot } from './types';

type StrategyCache = {
  key: string;
  backtest: StrategyBacktest;
};

const STRATEGY_CACHE = '.cache/strategy.json';
const STRATEGY_SCHEMA_VERSION = 'v27';

const getLatestLiveDate = (
  confirmed: Array<{ date: string }>,
  live: Array<{ date: string }>,
): string | null => {
  const confirmedDate = confirmed[confirmed.length - 1]?.date ?? null;
  const liveDate = live[live.length - 1]?.date ?? null;
  if (!confirmedDate || !liveDate || liveDate <= confirmedDate) return null;
  return liveDate;
};

export const getStrategyPayloads = async (): Promise<{
  backtest: StrategyBacktest;
  current: StrategySnapshot;
  staleMarketData: boolean;
  nextRetryAtMs: number | null;
}> => {
  const cached = await readJsonCache<StrategyCache>(STRATEGY_CACHE);
  const market = await fetchDailyPrices();
  const key = `${market.key}-${STRATEGY_SCHEMA_VERSION}`;
  const backtest: StrategyBacktest = cached?.key === key
    ? cached.backtest
    : runBacktest(market.data.TQQQ, market.data.SGOV);
  const refreshPhase = currentSingaporeRefreshPhase();
  const liveDate = getLatestLiveDate(market.data.TQQQ, market.liveData.TQQQ);
  const liveTqqqPoint = liveDate ? market.liveData.TQQQ[market.liveData.TQQQ.length - 1] : null;
  const liveSgovCandidate = liveDate ? market.liveData.SGOV[market.liveData.SGOV.length - 1] : null;
  const liveSgovPoint = liveSgovCandidate?.date === liveDate ? liveSgovCandidate : null;
  const current = refreshPhase === 'live-open' && liveTqqqPoint
    ? makeLiveCurrentSnapshot(backtest, market.data.TQQQ, market.data.SGOV, liveTqqqPoint, liveSgovPoint)
    : makeCurrentSnapshot(backtest);

  if (cached?.key !== key) {
    await writeJsonCache(STRATEGY_CACHE, { key, backtest });
  }

  return {
    backtest,
    current,
    staleMarketData: market.isStaleFallback,
    nextRetryAtMs: market.nextRetryAtMs,
  };
};
