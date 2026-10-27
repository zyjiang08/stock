import { differenceInCalendarDays, parseISO } from 'date-fns';
import { firstBusinessDayOfQuarter } from './calendar';
import {
  DefensiveAsset,
  PricePoint,
  RebalanceEvent,
  RuleState,
  StrategyBacktest,
  StrategyConfig,
  StrategySnapshot,
} from './types';

/** Format a Date as yyyy-MM-dd using UTC fields, avoiding date-fns format() which uses local time. */
const formatUtcDate = (date: Date): string => {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

const parseUtcDateKey = (date: string): Date => {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
};

const round2 = (n: number): number => Math.round(n * 100) / 100;
const CENT_EPSILON = 0.005;

const drawdownFromAth = (points: PricePoint[]): number => {
  const athClose = Math.max(...points.map((point) => point.close));
  return points[points.length - 1].close / athClose;
};

const athContext = (
  points: PricePoint[],
): { latestClose: number; trailingAthClose: number; trailingAthCloseDate: string; pctFromAth: number } => {
  const latestClose = points[points.length - 1].close;
  const trailingAthPoint = points.reduce((best, point) => (point.close >= best.close ? point : best), points[0]);
  const trailingAthClose = trailingAthPoint.close;

  return {
    latestClose,
    trailingAthClose,
    trailingAthCloseDate: trailingAthPoint.date,
    pctFromAth: ((latestClose / trailingAthClose) - 1) * 100,
  };
};

type AthDdTriggerContext = {
  date: string;
  close: number;
  athClose: number;
  athCloseDate: string;
  pctOfAth: number;
};

const cagr = (startValue: number, endValue: number, startDate: string, endDate: string): number => {
  const elapsedDays = Math.max(1, differenceInCalendarDays(parseISO(endDate), parseISO(startDate)));
  const years = elapsedDays / 365.25;
  if (years <= 0) return 0;
  return (Math.pow(endValue / startValue, 1 / years) - 1) * 100;
};

const maxDrawdown = (series: number[]): number => {
  let peak = series[0] ?? 1;
  let maxDd = 0;
  for (const point of series) {
    peak = Math.max(peak, point);
    maxDd = Math.max(maxDd, (peak - point) / peak);
  }
  return maxDd * 100;
};

const quarterFromMonth = (month: number): 1 | 2 | 3 | 4 => {
  if (month <= 2) return 1;
  if (month <= 5) return 2;
  if (month <= 8) return 3;
  return 4;
};

const getNextRebalanceDate = (asOfDate: string): string => {
  const d = parseUtcDateKey(asOfDate);
  let year = d.getUTCFullYear();
  let quarter = quarterFromMonth(d.getUTCMonth()) + 1;
  if (quarter === 5) {
    year += 1;
    quarter = 1;
  }
  return formatUtcDate(firstBusinessDayOfQuarter(year, quarter as 1 | 2 | 3 | 4));
};

const isRebalanceDate = (date: string): boolean => {
  const d = parseUtcDateKey(date);
  const year = d.getUTCFullYear();
  const quarter = quarterFromMonth(d.getUTCMonth());
  return formatUtcDate(firstBusinessDayOfQuarter(year, quarter)) === date;
};

const findLatestPointOnOrBefore = (points: PricePoint[], date: string): PricePoint | null => {
  for (let i = points.length - 1; i >= 0; i -= 1) {
    if (points[i].date <= date) return points[i];
  }

  return null;
};

const describeCurrentRebalanceAction = (event: RebalanceEvent): string => {
  const tradeDollars = `$${Math.abs(event.tqqqTradeDollars).toFixed(2)}`;

  if (event.action === 'buy_tqqq') {
    return `Quarterly Rebalance Today: Buy TQQQ ( ${tradeDollars} )`;
  }

  if (event.action === 'sell_tqqq') {
    return `Quarterly Rebalance Today: Sell TQQQ ( ${tradeDollars} )`;
  }

  if (event.intendedAction === 'buy_tqqq') {
    return 'Quarterly Rebalance Today: Hold ( Attempted Buy )';
  }

  if (event.intendedAction === 'sell_tqqq') {
    return 'Quarterly Rebalance Today: Hold ( Attempted Sell )';
  }

  return 'Quarterly Rebalance Today: Hold';
};

export const DEFAULT_STRATEGY_CONFIG: StrategyConfig = {
  name: 'PhoenixSig',
  trailingAthLookbackDays: 315,
  skipSellThresholdRatio: 0.7,
  skipSellWindowDays: 126,
  floorTriggerPct: 0.6,
  floorTargetPct: 0.6,
  nextQuarterTargetMultiplier: 1.15,
};

export const runBacktest = (tqqq: PricePoint[], sgov: PricePoint[], config: StrategyConfig = DEFAULT_STRATEGY_CONFIG): StrategyBacktest => {
  const sgovMap = new Map(sgov.map((point) => [point.date, point]));
  const rebalanceDates = new Set<string>();
  for (let y = 2010; y <= new Date().getUTCFullYear() + 1; y += 1) {
    for (const q of [1, 2, 3, 4] as const) {
      rebalanceDates.add(formatUtcDate(firstBusinessDayOfQuarter(y, q)));
    }
  }

  const start = tqqq[0];
  const initialSgovPoint = sgovMap.get(start.date);
  const initialDefensiveAsset: DefensiveAsset = initialSgovPoint ? 'SGOV' : 'CASH';
  const initialTqqqTradeDollars = 10000 * 0.9;
  const initialDefensiveValue = 1000;
  let tqqqShares = initialTqqqTradeDollars / start.open;
  let defensiveCash = initialDefensiveValue;
  let defensiveSgovShares = 0;
  let defensiveInSgov = false;
  let lastKnownSgovOpen: number | null = null;
  let lastKnownSgovClose: number | null = null;
  let tqqqTargetValue = initialTqqqTradeDollars * config.nextQuarterTargetMultiplier;
  let skipSellUntilIdx = -1;
  let lastAthDdTrigger: AthDdTriggerContext | null = null;

  const equityCurve: Array<{ date: string; value: number }> = [];
  const benchmarkTqqq: Array<{ date: string; value: number }> = [];
  const benchmarkDefensive: Array<{ date: string; value: number }> = [];
  const log: RebalanceEvent[] = [];
  let latestState: StrategyBacktest['latestState'] = {
    date: start.date,
    tqqqValue: round2(initialTqqqTradeDollars),
    defensiveValue: round2(initialDefensiveValue),
    portfolioValue: 10000,
    tqqqTargetValue: round2(tqqqTargetValue),
    defensiveAsset: initialDefensiveAsset,
    ruleState: {
      athDdActive: false,
      skipSellDaysRemaining: 0,
      skipSellWindowEnds: null,
      floorTriggered: false,
      latestClose: start.close,
      trailingAthClose: start.close,
      pctFromAth: 0,
      athDdTriggerDate: null,
      athDdTriggerClose: 0,
      athDdTriggerAthClose: 0,
      athDdTriggerAthCloseDate: null,
      athDdTriggerPctOfAth: 0,
    },
  };

  const inceptionTqqqShares = 10000 / start.open;
  const sgovFirstClose = sgov[0]?.close ?? 100;

  for (let i = 0; i < tqqq.length; i += 1) {
    const t = tqqq[i];
    const s = sgovMap.get(t.date);
    if (s) {
      lastKnownSgovOpen = s.open;
      lastKnownSgovClose = s.close;
    }
    if (s && !defensiveInSgov) {
      defensiveSgovShares = defensiveCash / s.open;
      defensiveCash = 0;
      defensiveInSgov = true;
    }

    const trailingStart = Math.max(0, i - (config.trailingAthLookbackDays - 1));
    const trailingPoints = tqqq.slice(trailingStart, i + 1);
    const ddRatio = drawdownFromAth(trailingPoints);
    const athStats = athContext(trailingPoints);
    if (config.skipSellWindowDays > 0 && ddRatio < config.skipSellThresholdRatio) {
      skipSellUntilIdx = i + config.skipSellWindowDays - 1;
      lastAthDdTrigger = {
        date: t.date,
        close: athStats.latestClose,
        athClose: athStats.trailingAthClose,
        athCloseDate: athStats.trailingAthCloseDate,
        pctOfAth: (athStats.latestClose / athStats.trailingAthClose) * 100,
      };
    }

    const skipActive = i <= skipSellUntilIdx;
    const skipDays = Math.max(0, skipSellUntilIdx - i + 1);
    const skipSellWindowEnds = skipDays > 0 && tqqq[skipSellUntilIdx]
      ? tqqq[skipSellUntilIdx].date
      : null;

    const tqqqValue = tqqqShares * t.open;
    const defensiveOpenPrice = s?.open ?? lastKnownSgovOpen ?? 1;
    const defensiveValue = defensiveInSgov ? (defensiveSgovShares * defensiveOpenPrice) + defensiveCash : defensiveCash;
    const portfolio = tqqqValue + defensiveValue;
    const floorTriggered = portfolio > 0 ? tqqqValue / portfolio < config.floorTriggerPct : false;
    const liveRuleState: RuleState = {
      athDdActive: skipActive,
      skipSellDaysRemaining: skipDays,
      skipSellWindowEnds,
      floorTriggered,
      latestClose: round2(athStats.latestClose),
      trailingAthClose: round2(athStats.trailingAthClose),
      pctFromAth: round2(athStats.pctFromAth),
      athDdTriggerDate: lastAthDdTrigger?.date ?? null,
      athDdTriggerClose: round2(lastAthDdTrigger?.close ?? 0),
      athDdTriggerAthClose: round2(lastAthDdTrigger?.athClose ?? 0),
      athDdTriggerAthCloseDate: lastAthDdTrigger?.athCloseDate ?? null,
      athDdTriggerPctOfAth: round2(lastAthDdTrigger?.pctOfAth ?? 0),
    };

    if (rebalanceDates.has(t.date)) {
      let desired = tqqqTargetValue;

      if (floorTriggered) desired = portfolio * config.floorTargetPct;

      const rawTrade = desired - tqqqValue;
      let intendedAction: 'buy_tqqq' | 'sell_tqqq' | 'hold' = 'hold';
      if (rawTrade > CENT_EPSILON) intendedAction = 'buy_tqqq';
      if (rawTrade < -CENT_EPSILON) intendedAction = 'sell_tqqq';

      let action: 'buy_tqqq' | 'sell_tqqq' | 'hold' = intendedAction;
      let trade = rawTrade;
      if (trade > 0) trade = Math.min(trade, defensiveValue);
      if (trade < 0) trade = Math.max(trade, -tqqqValue);
      trade = round2(trade);

      if (action === 'sell_tqqq' && skipActive) {
        trade = 0;
        action = 'hold';
      }
      if (trade === 0) {
        action = 'hold';
      }

      if (trade !== 0) {
        tqqqShares += trade / t.open;
        if (defensiveInSgov) {
          defensiveSgovShares -= trade / defensiveOpenPrice;
        } else {
          defensiveCash -= trade;
        }
      }

      const finalTqqqValue = tqqqShares * t.open;
      tqqqTargetValue = finalTqqqValue * config.nextQuarterTargetMultiplier;

      const state: RuleState = {
        athDdActive: skipActive,
        skipSellDaysRemaining: skipDays,
        skipSellWindowEnds,
        floorTriggered,
        latestClose: round2(athStats.latestClose),
        trailingAthClose: round2(athStats.trailingAthClose),
        pctFromAth: round2(athStats.pctFromAth),
        athDdTriggerDate: lastAthDdTrigger?.date ?? null,
        athDdTriggerClose: round2(lastAthDdTrigger?.close ?? 0),
        athDdTriggerAthClose: round2(lastAthDdTrigger?.athClose ?? 0),
        athDdTriggerAthCloseDate: lastAthDdTrigger?.athCloseDate ?? null,
        athDdTriggerPctOfAth: round2(lastAthDdTrigger?.pctOfAth ?? 0),
      };

      const sellingBlocked = skipActive && intendedAction === 'sell_tqqq' && action === 'hold';
      const buyingBlocked = intendedAction === 'buy_tqqq' && action === 'hold';
      const defensiveAsset: DefensiveAsset = defensiveInSgov ? 'SGOV' : 'CASH';
      let reason = 'Quarterly rebalance executed.';
      if (sellingBlocked) {
        reason = `No trade: ATH drawdown skip-sell guard blocked a sell signal ( ${skipDays} days remaining ).`;
      } else if (buyingBlocked && floorTriggered) {
        reason = `Floor guard triggered, but no additional TQQQ buy was possible because the defensive sleeve had no funds available.`;
      } else if (buyingBlocked) {
        reason = 'No trade: rebalance wanted to buy TQQQ, but the defensive sleeve had no funds available.';
      } else if (floorTriggered) {
        reason = `Floor guard triggered: TQQQ sleeve below ${(config.floorTriggerPct * 100).toFixed(0)}%, target reset to ${(config.floorTargetPct * 100).toFixed(0)}% of portfolio.`;
      } else if (action === 'hold') {
        reason = 'No trade: after guard checks, holdings were already within target limits.';
      }

      const defensiveAfter = defensiveInSgov ? (defensiveSgovShares * defensiveOpenPrice) + defensiveCash : defensiveCash;
      const totalAfter = finalTqqqValue + defensiveAfter;
      log.push({
        date: t.date,
        action,
        intendedAction,
        tqqqTradeDollars: round2(trade),
        defensiveTradeDollars: round2(-trade),
        tqqqValue: round2(finalTqqqValue),
        defensiveValue: round2(defensiveAfter),
        tqqqWeight: round2((finalTqqqValue / totalAfter) * 100),
        defensiveWeight: round2((1 - finalTqqqValue / totalAfter) * 100),
        ruleState: state,
        reason,
        defensiveAsset,
      });
    }

    const markTqqq = tqqqShares * t.close;
    const defensiveClosePrice = s?.close ?? lastKnownSgovClose ?? defensiveOpenPrice;
    const markDefensive = defensiveInSgov ? (defensiveSgovShares * defensiveClosePrice) + defensiveCash : defensiveCash;
    const total = markTqqq + markDefensive;

    equityCurve.push({ date: t.date, value: round2(total) });
    benchmarkTqqq.push({ date: t.date, value: round2(inceptionTqqqShares * t.close) });
    const benchmarkClose = s?.close ?? lastKnownSgovClose;
    benchmarkDefensive.push({
      date: t.date,
      value: benchmarkClose ? round2(10000 * (benchmarkClose / sgovFirstClose)) : 10000,
    });
    latestState = {
      date: t.date,
      tqqqValue: round2(markTqqq),
      defensiveValue: round2(markDefensive),
      portfolioValue: round2(total),
      tqqqTargetValue: round2(tqqqTargetValue),
      defensiveAsset: defensiveInSgov ? 'SGOV' : 'CASH',
      ruleState: liveRuleState,
    };
  }

  const first = equityCurve[0];
  const last = equityCurve[equityCurve.length - 1];
  const benchmarkFirst = benchmarkTqqq[0];
  const benchmarkLast = benchmarkTqqq[benchmarkTqqq.length - 1];

  return {
    initialState: {
      date: start.date,
      tqqqTradeDollars: round2(initialTqqqTradeDollars),
      tqqqValue: round2(initialTqqqTradeDollars),
      defensiveValue: round2(initialDefensiveValue),
      defensiveAsset: initialDefensiveAsset,
    },
    equityCurve,
    benchmark: {
      tqqqBuyAndHold: benchmarkTqqq,
      defensiveSleeve: benchmarkDefensive,
    },
    latestState,
    metrics: {
      finalValue: round2(last.value),
      cagr: round2(cagr(first.value, last.value, first.date, last.date)),
      maxDrawdown: round2(maxDrawdown(equityCurve.map((point) => point.value))),
      rebalanceCount: log.length,
      buyHoldFinalValue: round2(benchmarkLast.value),
      buyHoldCagr: round2(cagr(benchmarkFirst.value, benchmarkLast.value, benchmarkFirst.date, benchmarkLast.date)),
      buyHoldMaxDrawdown: round2(maxDrawdown(benchmarkTqqq.map((point) => point.value))),
    },
    rebalanceLog: log,
  };
};

export const makeCurrentSnapshot = (backtest: StrategyBacktest): StrategySnapshot => {
  const lastPoint = backtest.equityCurve[backtest.equityCurve.length - 1];
  const lastEvent = backtest.rebalanceLog[backtest.rebalanceLog.length - 1];
  const nextRebalanceDate = getNextRebalanceDate(lastPoint.date);
  const currentRebalanceEvent = lastEvent?.date === lastPoint.date ? lastEvent : null;

  return {
    asOfDate: lastPoint.date,
    confirmedCloseDate: lastPoint.date,
    marketTimestamp: Date.now(),
    nextRebalanceDate,
    action: `Hold / no action until next rebalance ( ${nextRebalanceDate} )`,
    portfolioValue: backtest.latestState.portfolioValue,
    tqqqValue: backtest.latestState.tqqqValue,
    defensiveValue: backtest.latestState.defensiveValue,
    tqqqTargetValue: backtest.latestState.tqqqTargetValue,
    defensiveAsset: backtest.latestState.defensiveAsset ?? lastEvent?.defensiveAsset ?? 'CASH',
    ruleState: backtest.latestState.ruleState ?? lastEvent?.ruleState ?? {
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
    currentRebalanceEvent,
  };
};

export const makeLiveCurrentSnapshot = (
  backtest: StrategyBacktest,
  confirmedTqqq: PricePoint[],
  confirmedSgov: PricePoint[],
  liveTqqqPoint: PricePoint,
  liveSgovPoint: PricePoint | null,
  config: StrategyConfig = DEFAULT_STRATEGY_CONFIG,
): StrategySnapshot => {
  const confirmedSnapshot = makeCurrentSnapshot(backtest);
  const confirmedCloseDate = confirmedSnapshot.confirmedCloseDate;

  if (liveTqqqPoint.date <= confirmedCloseDate) {
    return confirmedSnapshot;
  }

  const lastConfirmedTqqq = confirmedTqqq[confirmedTqqq.length - 1];
  if (!lastConfirmedTqqq) {
    return confirmedSnapshot;
  }

  const lastConfirmedSgov = findLatestPointOnOrBefore(confirmedSgov, confirmedCloseDate);
  const defensiveInSgov = backtest.latestState.defensiveAsset === 'SGOV';
  const confirmedDefensiveReference = lastConfirmedSgov?.close ?? lastConfirmedSgov?.open ?? 1;

  let tqqqShares = lastConfirmedTqqq.close > 0 ? backtest.latestState.tqqqValue / lastConfirmedTqqq.close : 0;
  let defensiveCash = defensiveInSgov ? 0 : backtest.latestState.defensiveValue;
  let defensiveSgovShares = defensiveInSgov && confirmedDefensiveReference > 0
    ? backtest.latestState.defensiveValue / confirmedDefensiveReference
    : 0;

  const tqqqOpen = liveTqqqPoint.open;
  const defensiveOpen = liveSgovPoint?.open ?? confirmedDefensiveReference;
  const skipSellDaysRemaining = Math.max(0, backtest.latestState.ruleState.skipSellDaysRemaining - 1);

  let tqqqValue = tqqqShares * tqqqOpen;
  let defensiveValue = defensiveInSgov ? (defensiveSgovShares * defensiveOpen) + defensiveCash : defensiveCash;
  let portfolioValue = tqqqValue + defensiveValue;
  let tqqqTargetValue = backtest.latestState.tqqqTargetValue;
  const floorTriggered = portfolioValue > 0 ? tqqqValue / portfolioValue < config.floorTriggerPct : false;
  let ruleState: RuleState = {
    ...backtest.latestState.ruleState,
    athDdActive: skipSellDaysRemaining > 0,
    skipSellDaysRemaining,
    floorTriggered,
  };
  let nextRebalanceDate = getNextRebalanceDate(liveTqqqPoint.date);
  let action = `Hold / no action until next rebalance ( ${nextRebalanceDate} )`;
  let currentRebalanceEvent: RebalanceEvent | null = null;

  if (isRebalanceDate(liveTqqqPoint.date)) {
    let desired = tqqqTargetValue;
    if (floorTriggered) desired = portfolioValue * config.floorTargetPct;

    const rawTrade = desired - tqqqValue;
    let intendedAction: 'buy_tqqq' | 'sell_tqqq' | 'hold' = 'hold';
    if (rawTrade > CENT_EPSILON) intendedAction = 'buy_tqqq';
    if (rawTrade < -CENT_EPSILON) intendedAction = 'sell_tqqq';

    let projectedAction: 'buy_tqqq' | 'sell_tqqq' | 'hold' = intendedAction;
    let trade = rawTrade;
    if (trade > 0) trade = Math.min(trade, defensiveValue);
    if (trade < 0) trade = Math.max(trade, -tqqqValue);
    trade = round2(trade);

    if (projectedAction === 'sell_tqqq' && ruleState.athDdActive) {
      trade = 0;
      projectedAction = 'hold';
    }
    if (trade === 0) {
      projectedAction = 'hold';
    }

    if (trade !== 0) {
      tqqqShares += trade / tqqqOpen;
      if (defensiveInSgov) {
        defensiveSgovShares -= trade / defensiveOpen;
      } else {
        defensiveCash -= trade;
      }
    }

    const finalTqqqValue = tqqqShares * tqqqOpen;
    const defensiveAfter = defensiveInSgov ? (defensiveSgovShares * defensiveOpen) + defensiveCash : defensiveCash;
    const totalAfter = finalTqqqValue + defensiveAfter;
    const defensiveAsset: DefensiveAsset = defensiveInSgov ? 'SGOV' : 'CASH';
    const sellingBlocked = ruleState.athDdActive && intendedAction === 'sell_tqqq' && projectedAction === 'hold';
    const buyingBlocked = intendedAction === 'buy_tqqq' && projectedAction === 'hold';

    let reason = 'Quarterly rebalance executed.';
    if (sellingBlocked) {
      reason = `No trade: ATH drawdown skip-sell guard blocked a sell signal ( ${skipSellDaysRemaining} days remaining ).`;
    } else if (buyingBlocked && floorTriggered) {
      reason = 'Floor guard triggered, but no additional TQQQ buy was possible because the defensive sleeve had no funds available.';
    } else if (buyingBlocked) {
      reason = 'No trade: rebalance wanted to buy TQQQ, but the defensive sleeve had no funds available.';
    } else if (floorTriggered) {
      reason = `Floor guard triggered: TQQQ sleeve below ${(config.floorTriggerPct * 100).toFixed(0)}%, target reset to ${(config.floorTargetPct * 100).toFixed(0)}% of portfolio.`;
    } else if (projectedAction === 'hold') {
      reason = 'No trade: after guard checks, holdings were already within target limits.';
    }

    currentRebalanceEvent = {
      date: liveTqqqPoint.date,
      action: projectedAction,
      intendedAction,
      tqqqTradeDollars: round2(trade),
      defensiveTradeDollars: round2(-trade),
      tqqqValue: round2(finalTqqqValue),
      defensiveValue: round2(defensiveAfter),
      tqqqWeight: totalAfter > 0 ? round2((finalTqqqValue / totalAfter) * 100) : 0,
      defensiveWeight: totalAfter > 0 ? round2((1 - (finalTqqqValue / totalAfter)) * 100) : 0,
      ruleState,
      reason,
      defensiveAsset,
    };

    tqqqValue = finalTqqqValue;
    defensiveValue = defensiveAfter;
    portfolioValue = totalAfter;
    tqqqTargetValue = finalTqqqValue * config.nextQuarterTargetMultiplier;
    nextRebalanceDate = getNextRebalanceDate(liveTqqqPoint.date);
    action = describeCurrentRebalanceAction(currentRebalanceEvent);
  }

  return {
    asOfDate: liveTqqqPoint.date,
    confirmedCloseDate,
    marketTimestamp: Date.now(),
    nextRebalanceDate,
    action,
    portfolioValue: round2(portfolioValue),
    tqqqValue: round2(tqqqValue),
    defensiveValue: round2(defensiveValue),
    tqqqTargetValue: round2(tqqqTargetValue),
    defensiveAsset: defensiveInSgov ? 'SGOV' : 'CASH',
    ruleState,
    currentRebalanceEvent,
  };
};
