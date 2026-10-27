import { runBacktest, DEFAULT_STRATEGY_CONFIG } from '../lib/strategy/engine.ts';
import type { PricePoint, StrategyConfig } from '../lib/strategy/types.ts';

type VariantResult = {
  name: string;
  finalValue: number;
  cagr: number;
  maxDrawdown: number;
  edgePct: number;
  blockedSells: number;
  blockedBuys: number;
};

const NEW_YORK_CLOSE_CONFIRM_MINUTE = (16 * 60) + 15;

const formatUtcDate = (date: Date): string => {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

const getNewYorkClock = (nowMs: number): { date: string; minuteOfDay: number } => {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });

  const parts = Object.fromEntries(
    formatter
      .formatToParts(new Date(nowMs))
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  ) as Record<'year' | 'month' | 'day' | 'hour' | 'minute', string>;

  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minuteOfDay: (Number(parts.hour) * 60) + Number(parts.minute),
  };
};

const filterToConfirmedDailyCloses = (points: PricePoint[], nowMs = Date.now()): PricePoint[] => {
  if (points.length === 0) return points;

  const latest = points[points.length - 1];
  const newYorkClock = getNewYorkClock(nowMs);

  if (latest.date > newYorkClock.date) {
    return points.slice(0, -1);
  }

  if (latest.date === newYorkClock.date && newYorkClock.minuteOfDay < NEW_YORK_CLOSE_CONFIRM_MINUTE) {
    return points.slice(0, -1);
  }

  return points;
};

const fetchTicker = async (ticker: string, fromUnix: number): Promise<PricePoint[]> => {
  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}`);
  url.searchParams.set('period1', String(fromUnix));
  url.searchParams.set('period2', String(Math.floor(Date.now() / 1000)));
  url.searchParams.set('interval', '1d');
  url.searchParams.set('events', 'history');

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Yahoo fetch failed for ${ticker}: ${res.status}`);
  }

  const json = await res.json();
  const result = json.chart?.result?.[0];
  const timestamps: number[] = result?.timestamp ?? [];
  const quotes = result?.indicators?.quote?.[0];
  const opens: Array<number | null> = quotes?.open ?? [];
  const closes: Array<number | null> = quotes?.close ?? [];
  const highs: Array<number | null> = quotes?.high ?? [];

  const rows = timestamps
    .map((timestamp, index): PricePoint | null => {
      const open = opens[index];
      const close = closes[index];
      if (open == null || close == null) return null;

      return {
        date: formatUtcDate(new Date(timestamp * 1000)),
        open,
        close,
        high: highs[index] ?? Math.max(open, close),
      };
    })
    .filter((row): row is PricePoint => row !== null);

  return filterToConfirmedDailyCloses(rows);
};

const formatUsd = (value: number): string => `$${Math.round(value).toLocaleString('en-US')}`;

const summarizeVariant = (name: string, config: StrategyConfig, tqqq: PricePoint[], sgov: PricePoint[]): VariantResult => {
  const result = runBacktest(tqqq, sgov, config);
  return {
    name,
    finalValue: result.metrics.finalValue,
    cagr: result.metrics.cagr,
    maxDrawdown: result.metrics.maxDrawdown,
    edgePct: ((result.metrics.finalValue / result.metrics.buyHoldFinalValue) - 1) * 100,
    blockedSells: result.rebalanceLog.filter((event) => event.intendedAction === 'sell_tqqq' && event.action === 'hold').length,
    blockedBuys: result.rebalanceLog.filter((event) => event.intendedAction === 'buy_tqqq' && event.action === 'hold').length,
  };
};

const familyFromArgs = (): 'all' | 'core' => {
  const familyArg = process.argv.slice(2).find((arg) => arg.startsWith('--family='));
  if (!familyArg) return 'all';

  const family = familyArg.split('=')[1];
  if (family === 'core' || family === 'all') {
    return family;
  }

  throw new Error(`Unsupported family: ${family}`);
};

const outputJson = process.argv.includes('--json');

const buildVariants = (family: 'all' | 'core'): Array<{ name: string; config: StrategyConfig }> => {
  const baseline = { name: 'baseline', config: { ...DEFAULT_STRATEGY_CONFIG } };
  const core = [
    baseline,
    { name: 'target 1.14', config: { ...DEFAULT_STRATEGY_CONFIG, nextQuarterTargetMultiplier: 1.14 } },
    { name: 'target 1.15', config: { ...DEFAULT_STRATEGY_CONFIG, nextQuarterTargetMultiplier: 1.15 } },
    { name: 'skip window 63', config: { ...DEFAULT_STRATEGY_CONFIG, skipSellWindowDays: 63 } },
    { name: 'skip window 126', config: { ...DEFAULT_STRATEGY_CONFIG, skipSellWindowDays: 126 } },
  ];

  if (family === 'core') return core;
  return core;
};

const family = familyFromArgs();
const variants = buildVariants(family);
const fromUnix = Math.floor(Date.UTC(2010, 1, 1) / 1000);

const [tqqq, sgov] = await Promise.all([fetchTicker('TQQQ', fromUnix), fetchTicker('SGOV', fromUnix)]);
const results = variants
  .map((variant) => summarizeVariant(variant.name, variant.config, tqqq, sgov))
  .sort((left, right) => right.edgePct - left.edgePct);

if (outputJson) {
  console.log(JSON.stringify({
    sample: {
      start: tqqq[0]?.date ?? null,
      end: tqqq[tqqq.length - 1]?.date ?? null,
      rows: tqqq.length,
      family,
    },
    results,
  }, null, 2));
} else {
  console.table(results.map((result) => ({
    variant: result.name,
    finalValue: formatUsd(result.finalValue),
    edgePct: `${result.edgePct.toFixed(2)}%`,
    cagr: `${result.cagr.toFixed(2)}%`,
    maxDrawdown: `${result.maxDrawdown.toFixed(2)}%`,
    blockedSells: result.blockedSells,
    blockedBuys: result.blockedBuys,
  })));
}
