import { describe, expect, it } from 'vitest';
import { makeCurrentSnapshot, makeLiveCurrentSnapshot, runBacktest } from '@/lib/strategy/engine';
import { PricePoint } from '@/lib/strategy/types';

// Real rebalance dates after UTC fix (first US business day of each quarter month):
//   Q1 2010 → 2010-01-04  (Jan 1 = New Year's, Jan 2-3 = weekend)
//   Q2 2010 → 2010-04-01  (Apr 1 = Thursday, no US holiday)
//   Q3 2010 → 2010-07-01  (Jul 1 = Thursday, no US holiday)
//   Q4 2010 → 2010-10-01  (Oct 1 = Friday, no US holiday)

const makeData = (): { tqqq: PricePoint[]; sgov: PricePoint[] } => {
  const dates = [
    '2010-01-04', '2010-01-05', '2010-01-06', '2010-01-07', '2010-01-08',
    '2010-04-01', '2010-04-02', '2010-07-01', '2010-10-01',
  ];

  const tqqq = dates.map((d, i) => ({ date: d, open: 100 - i * 2, close: 100 - i * 2 }));
  const sgov = dates.map((d, i) => ({ date: d, open: 100 + i * 0.1, close: 100 + i * 0.1 }));
  return { tqqq, sgov };
};

describe('runBacktest', () => {
  it('Keeps initial allocation around 90/10.', () => {
    const { tqqq, sgov } = makeData();
    const result = runBacktest(tqqq, sgov);
    const first = result.equityCurve[0];
    expect(first.value).toBeGreaterThan(9900);
    expect(first.value).toBeLessThan(10100);
    expect(result.initialState.date).toBe('2010-01-04');
    expect(result.initialState.tqqqTradeDollars).toBe(9000);
    expect(result.initialState.tqqqValue).toBe(9000);
    expect(result.initialState.defensiveValue).toBe(1000);
    expect(result.initialState.defensiveAsset).toBe('SGOV');
  });

  it('Creates rebalance log entries.', () => {
    const { tqqq, sgov } = makeData();
    const result = runBacktest(tqqq, sgov);
    expect(result.rebalanceLog.length).toBeGreaterThan(0);
  });

  it('Produces stable metrics schema.', () => {
    const { tqqq, sgov } = makeData();
    const result = runBacktest(tqqq, sgov);
    expect(result.metrics).toHaveProperty('finalValue');
    expect(result.metrics).toHaveProperty('cagr');
    expect(result.metrics).toHaveProperty('maxDrawdown');
    expect(result.metrics).toHaveProperty('rebalanceCount');
    expect(result.metrics).toHaveProperty('buyHoldFinalValue');
    expect(result.metrics).toHaveProperty('buyHoldCagr');
    expect(result.metrics).toHaveProperty('buyHoldMaxDrawdown');
  });

  it('Avoids defensive sleeve jump when SGOV data begins later.', () => {
    const tqqq: PricePoint[] = [
      { date: '2010-01-04', open: 100, close: 100 },
      { date: '2010-01-05', open: 100, close: 100 },
      { date: '2010-01-06', open: 100, close: 100 },
      { date: '2010-01-07', open: 100, close: 100 },
    ];
    const sgov: PricePoint[] = [
      { date: '2010-01-06', open: 100, close: 100 },
      { date: '2010-01-07', open: 100, close: 100 },
    ];

    const result = runBacktest(tqqq, sgov);
    expect(result.equityCurve[1].value).toBe(10000);
    expect(result.equityCurve[2].value).toBe(10000);
  });

  it('Calculates CAGR using elapsed calendar time.', () => {
    const tqqq: PricePoint[] = [
      { date: '2010-01-04', open: 100, close: 100 },
      { date: '2010-12-31', open: 110, close: 110 },
    ];
    const sgov: PricePoint[] = [];

    const result = runBacktest(tqqq, sgov);
    expect(result.metrics.cagr).toBeGreaterThan(8);
    expect(result.metrics.cagr).toBeLessThan(11);
  });

  it('Uses last known SGOV quote when a daily SGOV row is missing.', () => {
    const tqqq: PricePoint[] = [
      { date: '2010-01-04', open: 100, close: 100 },
      { date: '2010-01-05', open: 100, close: 100 },
      { date: '2010-01-06', open: 100, close: 100 },
      { date: '2010-01-07', open: 100, close: 100 },
    ];
    const sgov: PricePoint[] = [
      { date: '2010-01-05', open: 100, close: 100 },
      { date: '2010-01-07', open: 100, close: 100 },
    ];

    const result = runBacktest(tqqq, sgov);
    expect(result.equityCurve[2].value).toBe(10000);
  });

  it('Builds current snapshot sleeve values from live latest state.', () => {
    const tqqq: PricePoint[] = [
      { date: '2010-01-04', open: 100, close: 100 },
      { date: '2010-01-05', open: 200, close: 200 },
    ];
    const sgov: PricePoint[] = [];

    const result = runBacktest(tqqq, sgov);
    const snapshot = makeCurrentSnapshot(result);

    expect(snapshot.tqqqValue).toBeGreaterThan(snapshot.defensiveValue);
    expect(snapshot.portfolioValue).toBe(snapshot.tqqqValue + snapshot.defensiveValue);
    expect(snapshot.defensiveAsset).toBe('CASH');
    expect(snapshot.confirmedCloseDate).toBe('2010-01-05');
    expect(snapshot.currentRebalanceEvent).toBeNull();
  });

  it('Projects a live-session snapshot onto the current trading date before the close is confirmed.', () => {
    const confirmedTqqq: PricePoint[] = [
      { date: '2010-03-31', open: 100, close: 100 },
    ];
    const confirmedSgov: PricePoint[] = [
      { date: '2010-03-31', open: 100, close: 100 },
    ];
    const liveTqqqPoint: PricePoint = { date: '2010-04-01', open: 50, close: 50 };
    const liveSgovPoint: PricePoint = { date: '2010-04-01', open: 100, close: 100 };

    const backtest = runBacktest(confirmedTqqq, confirmedSgov);
    const snapshot = makeLiveCurrentSnapshot(backtest, confirmedTqqq, confirmedSgov, liveTqqqPoint, liveSgovPoint);

    expect(snapshot.asOfDate).toBe('2010-04-01');
    expect(snapshot.confirmedCloseDate).toBe('2010-03-31');
    expect(snapshot.currentRebalanceEvent?.date).toBe('2010-04-01');
    expect(snapshot.currentRebalanceEvent?.action).toBe('buy_tqqq');
    expect(snapshot.nextRebalanceDate).toBe('2010-07-01');
  });

  it('Uses the prior confirmed skip-sell state for a live rebalance-day projection.', () => {
    const confirmedTqqq: PricePoint[] = [
      { date: '2010-01-04', open: 100, close: 100 },
      { date: '2010-02-01', open: 300, close: 300 },
      { date: '2010-03-31', open: 200, close: 200 },
    ];
    const liveTqqqPoint: PricePoint = { date: '2010-04-01', open: 200, close: 200 };

    const backtest = runBacktest(confirmedTqqq, []);
    const snapshot = makeLiveCurrentSnapshot(backtest, confirmedTqqq, [], liveTqqqPoint, null);

    expect(snapshot.currentRebalanceEvent?.action).toBe('hold');
    expect(snapshot.currentRebalanceEvent?.intendedAction).toBe('sell_tqqq');
    expect(snapshot.ruleState.athDdActive).toBe(true);
    expect(snapshot.ruleState.skipSellDaysRemaining).toBe(125);
  });

  it('Clamps buy size to available defensive sleeve value and rolls the next target to 115%.', () => {
    // Q2 2010 rebalance date = 2010-04-01
    // Price drops to 50: TQQQ value = 90 * 50 = $4500, target = $10350, buys all $1000 defensive → defensive = $0
    const tqqq: PricePoint[] = [
      { date: '2010-02-01', open: 100, close: 100 },
      { date: '2010-04-01', open: 50, close: 50 },
    ];
    const sgov: PricePoint[] = [];

    const result = runBacktest(tqqq, sgov);
    const event = result.rebalanceLog.find((row) => row.date === '2010-04-01');
    expect(event?.action).toBe('buy_tqqq');
    expect(event?.intendedAction).toBe('buy_tqqq');
    expect(event?.tqqqTradeDollars).toBeLessThanOrEqual(1000);
    expect(event?.tqqqValue).toBeGreaterThan(0);
    expect(event?.defensiveValue).toBe(0);
    expect(event?.tqqqWeight).toBe(100);
    expect(result.latestState.tqqqTargetValue).toBeCloseTo((event?.tqqqValue ?? 0) * 1.15, 2);
    expect(result.latestState.defensiveValue).toBeGreaterThanOrEqual(0);
  });

  it('Keeps sell proceeds in defensive sleeve when SGOV row is missing on rebalance day.', () => {
    // Q2 2010 rebalance date = 2010-04-01
    // Price doubles to 200 → TQQQ above target → sell excess to defensive
    const tqqq: PricePoint[] = [
      { date: '2010-01-04', open: 100, close: 100 },
      { date: '2010-01-05', open: 100, close: 100 },
      { date: '2010-04-01', open: 200, close: 200 },
    ];
    const sgov: PricePoint[] = [
      { date: '2010-01-05', open: 100, close: 100 },
    ];

    const result = runBacktest(tqqq, sgov);
    expect(result.latestState.defensiveValue).toBeGreaterThan(1000);
    expect(result.latestState.portfolioValue).toBeGreaterThan(18000);
  });

  it('Records attempted sell intent when skip-sell guard forces a hold.', () => {
    // Q2 2010 rebalance date = 2010-04-01
    // Price spikes to 300 then drops to 200 — below 70% of ATH (300), skip-sell guard activates
    const tqqq: PricePoint[] = [
      { date: '2010-01-04', open: 100, close: 100 },
      { date: '2010-02-01', open: 300, close: 300 },
      { date: '2010-04-01', open: 200, close: 200 },
    ];
    const sgov: PricePoint[] = [];

    const result = runBacktest(tqqq, sgov);
    const event = result.rebalanceLog.find((row) => row.date === '2010-04-01');

    expect(event?.action).toBe('hold');
    expect(event?.intendedAction).toBe('sell_tqqq');
  });

  it('Explains when a rebalance wanted to buy but had no defensive funds left.', () => {
    // Q2=2010-04-01: price drops to 50 → buys all $1000 defensive → defensive = $0
    // Q3=2010-07-01: price drops to 40 → wants to buy TQQQ but defensive = $0 → hold
    const tqqq: PricePoint[] = [
      { date: '2010-01-04', open: 100, close: 100 },
      { date: '2010-04-01', open: 50, close: 50 },
      { date: '2010-07-01', open: 40, close: 40 },
    ];
    const sgov: PricePoint[] = [];

    const result = runBacktest(tqqq, sgov);
    const event = result.rebalanceLog.find((row) => row.date === '2010-07-01');

    expect(event?.action).toBe('hold');
    expect(event?.intendedAction).toBe('buy_tqqq');
    expect(event?.reason).toMatch(/wanted to buy TQQQ/i);
    expect(event?.reason).toMatch(/no funds available/i);
  });

  it('Treats sub-cent buy dust as a hold instead of logging a $0 buy.', () => {
    // Q2=2010-04-01, Q3=2010-07-01
    // Price at Q2 is just barely above target so defensive sleeve is nearly zeroed out
    // At Q3 price drops — engine wants to buy but has sub-cent dust left
    const tqqq: PricePoint[] = [
      { date: '2010-01-04', open: 100, close: 100 },
      { date: '2010-04-01', open: 103.8889333333, close: 103.8889333333 },
      { date: '2010-07-01', open: 50, close: 50 },
    ];
    const sgov: PricePoint[] = [
      { date: '2010-01-04', open: 100, close: 100 },
      { date: '2010-04-01', open: 100, close: 100 },
      { date: '2010-07-01', open: 100, close: 100 },
    ];

    const result = runBacktest(tqqq, sgov);
    const event = result.rebalanceLog.find((row) => row.date === '2010-07-01');

    expect(event?.action).toBe('hold');
    expect(event?.intendedAction).toBe('buy_tqqq');
    expect(event?.tqqqTradeDollars).toBe(0);
    expect(event?.reason).toMatch(/wanted to buy TQQQ/i);
  });

  it('Does not rewrite historical rebalance or skip-sell history when only a later non-rebalance bar is added.', () => {
    const baseTqqq: PricePoint[] = [
      { date: '2010-01-04', open: 100, close: 100 },
      { date: '2010-02-01', open: 300, close: 300 },
      { date: '2010-04-01', open: 200, close: 200 },
      { date: '2010-07-01', open: 180, close: 180 },
    ];
    const extendedTqqq: PricePoint[] = [
      ...baseTqqq,
      { date: '2010-07-02', open: 170, close: 170 },
    ];

    const base = runBacktest(baseTqqq, []);
    const extended = runBacktest(extendedTqqq, []);

    expect(extended.rebalanceLog).toEqual(base.rebalanceLog);
    expect(base.rebalanceLog.find((row) => row.date === '2010-07-01')?.ruleState.skipSellDaysRemaining)
      .toBe(extended.rebalanceLog.find((row) => row.date === '2010-07-01')?.ruleState.skipSellDaysRemaining);
    expect(base.latestState.date).toBe('2010-07-01');
    expect(extended.latestState.date).toBe('2010-07-02');
    expect(base.latestState.ruleState.skipSellDaysRemaining).toBe(126);
    expect(extended.latestState.ruleState.skipSellDaysRemaining).toBe(126);
  });

  it('Refreshes the skip-sell countdown daily while the ATH drawdown condition remains true.', () => {
    const tqqq: PricePoint[] = [
      { date: '2010-01-04', open: 100, close: 100 },
      { date: '2010-02-01', open: 300, close: 300 },
      { date: '2010-02-02', open: 205, close: 205 },
      { date: '2010-02-03', open: 200, close: 200 },
      { date: '2010-02-04', open: 290, close: 290 },
      { date: '2010-02-05', open: 205, close: 205 },
    ];

    const result = runBacktest(tqqq, []);

    expect(result.latestState.ruleState.skipSellDaysRemaining).toBe(126);
  });

  it('Tracks the most recent ATH DD trigger day separately from the current close context.', () => {
    const tqqq: PricePoint[] = [
      { date: '2010-01-04', open: 100, close: 100 },
      { date: '2010-02-01', open: 300, close: 300 },
      { date: '2010-02-02', open: 205, close: 205 },
      { date: '2010-02-03', open: 250, close: 250 },
    ];

    const result = runBacktest(tqqq, []);

    expect(result.latestState.ruleState.athDdActive).toBe(true);
    expect(result.latestState.ruleState.latestClose).toBe(250);
    expect(result.latestState.ruleState.trailingAthClose).toBe(300);
    expect(result.latestState.ruleState.athDdTriggerDate).toBe('2010-02-02');
    expect(result.latestState.ruleState.athDdTriggerClose).toBe(205);
    expect(result.latestState.ruleState.athDdTriggerAthClose).toBe(300);
    expect(result.latestState.ruleState.athDdTriggerAthCloseDate).toBe('2010-02-01');
    expect(result.latestState.ruleState.athDdTriggerPctOfAth).toBeCloseTo(68.33, 2);
  });

  it('Uses daily close rather than daily high as the ATH reference for the skip-sell breach.', () => {
    const tqqq: PricePoint[] = [
      { date: '2010-01-04', open: 100, close: 100, high: 100 },
      { date: '2010-02-01', open: 300, close: 250, high: 300 },
      { date: '2010-02-02', open: 205, close: 205, high: 205 },
    ];

    const result = runBacktest(tqqq, []);

    expect(result.latestState.ruleState.trailingAthClose).toBe(250);
    expect(result.latestState.ruleState.athDdActive).toBe(false);
    expect(result.latestState.ruleState.skipSellDaysRemaining).toBe(0);
  });

});
