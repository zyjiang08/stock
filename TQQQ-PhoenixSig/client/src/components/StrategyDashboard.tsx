import { differenceInCalendarDays, format, parseISO, subMonths, subYears } from 'date-fns';
import { useEffect, useMemo, useState } from 'react';
import { currentSingaporeRefreshPhase } from '../../../server/time/singapore-refresh';
import type { StrategyBacktest, StrategySnapshot } from '../../../server/strategy/types';
import { DailyRefreshCountdown } from './DailyRefreshCountdown';
import { PerformanceChart, type ChartPoint } from './PerformanceChart';

type Props = {
  current: StrategySnapshot;
  backtest: StrategyBacktest;
  staleMarketData: boolean;
  nextRetryAtMs: number | null;
  onRefreshNeeded?: () => void;
};

type Range = '3m' | '6m' | '1y' | '3y' | '5y' | 'all' | 'custom';
type TradeLogRow = {
  id: string;
  date: string;
  actionLabel: string;
  tqqqValue: number;
  defensiveValue: number;
  reason: string;
  floorReason: string | null;
};

const TRADE_LOG_PAGE_SIZES = [5, 10, 25, 50, 100, 'all'] as const;
type TradeLogPageSize = (typeof TRADE_LOG_PAGE_SIZES)[number];
const TARGET_GROWTH_GOAL_PCT = 15;
const SKIP_SELL_TRIGGER_PCT = 70;

const alignBenchmarkToCurve = (
  curve: StrategyBacktest['equityCurve'],
  benchmark: Array<{ date: string; value: number }>,
): number[] => {
  const fallback = benchmark[0]?.value ?? curve[0]?.value ?? 0;
  let benchmarkIndex = 0;
  let lastKnownValue = fallback;

  return curve.map((point) => {
    while (benchmarkIndex + 1 < benchmark.length && benchmark[benchmarkIndex + 1].date <= point.date) {
      benchmarkIndex += 1;
    }

    const benchmarkPoint = benchmark[benchmarkIndex];
    if (benchmarkPoint && benchmarkPoint.date <= point.date) {
      lastKnownValue = benchmarkPoint.value;
    }

    return lastKnownValue;
  });
};

const fmtCurrency = (n: number): string => `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const fmtPercent = (n: number): string => `${n.toFixed(2)}%`;

const cutoffForRange = (range: Exclude<Range, 'custom'>, endDate: Date): Date | null => {
  if (range === 'all') return null;
  if (range === '3m') return subMonths(endDate, 3);
  if (range === '6m') return subMonths(endDate, 6);
  if (range === '1y') return subYears(endDate, 1);
  if (range === '3y') return subYears(endDate, 3);
  return subYears(endDate, 5);
};

const clampDate = (date: string, minDate: string, maxDate: string): string => {
  if (!date) return minDate;
  if (date < minDate) return minDate;
  if (date > maxDate) return maxDate;
  return date;
};

const baseActionLabel = (action: string, intendedAction?: string): string => {
  if (action === 'buy_tqqq') return 'Buy TQQQ';
  if (action === 'sell_tqqq') return 'Sell TQQQ';
  if (intendedAction === 'buy_tqqq') return 'Hold ( attempted buy )';
  if (intendedAction === 'sell_tqqq') return 'Hold ( attempted sell )';
  return 'Hold';
};

const actionLabel = (action: string, tqqqTradeDollars: number, intendedAction?: string): string => {
  const label = baseActionLabel(action, intendedAction);

  if (action === 'buy_tqqq' || action === 'sell_tqqq') {
    return `${label} - ${fmtCurrency(Math.abs(tqqqTradeDollars))}`;
  }

  return label;
};

const summarizeRebalanceEvent = (
  event: StrategyBacktest['rebalanceLog'][number],
): { value: string; detail: string; tone: 'hit' | 'far' | 'hold' } => {
  const tone = event.action === 'buy_tqqq'
    ? 'hit'
    : event.action === 'sell_tqqq'
      ? 'far'
      : event.intendedAction === 'buy_tqqq'
        ? 'hit'
        : event.intendedAction === 'sell_tqqq'
          ? 'far'
          : 'hold';

  return {
    value: baseActionLabel(event.action, event.intendedAction),
    detail: event.reason,
    tone,
  };
};

const summarizeCurrentAction = (
  current: StrategySnapshot,
  latestRebalanceEvent?: StrategyBacktest['rebalanceLog'][number],
): { value: string; detail: string; tone: 'hit' | 'far' | 'hold' } => {
  const event = current.currentRebalanceEvent;
  if (!event) {
    if (latestRebalanceEvent) {
      return summarizeRebalanceEvent(latestRebalanceEvent);
    }

    return {
      value: 'Hold',
      detail: `No Rebalance Due Until ${current.nextRebalanceDate}.`,
      tone: 'hold',
    };
  }

  return summarizeRebalanceEvent(event);
};

export function StrategyDashboard({ current, backtest, staleMarketData, nextRetryAtMs, onRefreshNeeded }: Props) {
  const chartPoints = useMemo<ChartPoint[]>(
    () => {
      const tqqqBuyHold = alignBenchmarkToCurve(backtest.equityCurve, backtest.benchmark.tqqqBuyAndHold);
      const initialPortfolioValue = backtest.initialState.tqqqValue + backtest.initialState.defensiveValue;

      return [
        {
          date: backtest.initialState.date,
          strategyValue: initialPortfolioValue,
          buyHoldValue: initialPortfolioValue,
        },
        ...backtest.equityCurve.map((point, index) => ({
          date: point.date,
          strategyValue: point.value,
          buyHoldValue: tqqqBuyHold[index] ?? point.value,
        })),
      ];
    },
    [backtest.benchmark.tqqqBuyAndHold, backtest.equityCurve, backtest.initialState],
  );

  const minDate = chartPoints[0]?.date ?? current.asOfDate;
  const maxDate = chartPoints[chartPoints.length - 1]?.date ?? current.asOfDate;
  const [range, setRange] = useState<Range>('all');
  const [startDate, setStartDate] = useState(minDate);
  const [endDate, setEndDate] = useState(maxDate);
  const [tradeLogPageSize, setTradeLogPageSize] = useState<TradeLogPageSize>(25);
  const [tradeLogPage, setTradeLogPage] = useState(1);

  const applyPreset = (nextRange: Exclude<Range, 'custom'>) => {
    const end = parseISO(maxDate);
    const cutoff = cutoffForRange(nextRange, end);
    const nextStart = cutoff ? clampDate(format(cutoff, 'yyyy-MM-dd'), minDate, maxDate) : minDate;

    setRange(nextRange);
    setStartDate(nextStart);
    setEndDate(maxDate);
  };

  const normalizedStart = startDate <= endDate ? startDate : endDate;
  const normalizedEnd = endDate >= startDate ? endDate : startDate;

  const filteredChartPoints = useMemo(
    () => chartPoints.filter((point) => point.date >= normalizedStart && point.date <= normalizedEnd),
    [chartPoints, normalizedEnd, normalizedStart],
  );

  const filteredEvents = useMemo(
    () => backtest.rebalanceLog.filter((event) => event.date >= normalizedStart && event.date <= normalizedEnd),
    [backtest.rebalanceLog, normalizedEnd, normalizedStart],
  );

  const tradeLogRows = useMemo<TradeLogRow[]>(() => {
    const rows: TradeLogRow[] = filteredEvents.map((event, index) => ({
      id: `${event.date}-${event.action}-${index}`,
      date: event.date,
      actionLabel: actionLabel(event.action, event.tqqqTradeDollars, event.intendedAction),
      tqqqValue: event.tqqqValue,
      defensiveValue: event.defensiveValue,
      reason: event.reason,
      floorReason: event.ruleState.floorTriggered
        ? 'Floor triggered: TQQQ sleeve was below 60%, so the rebalance floor logic applied.'
        : null,
    }));

    if (backtest.initialState.date >= normalizedStart && backtest.initialState.date <= normalizedEnd) {
      rows.unshift({
        id: `init-${backtest.initialState.date}`,
        date: backtest.initialState.date,
        actionLabel: `Initialise - ${fmtCurrency(Math.abs(backtest.initialState.tqqqTradeDollars))}`,
        tqqqValue: backtest.initialState.tqqqValue,
        defensiveValue: backtest.initialState.defensiveValue,
        reason: 'Strategy initialised at 90% TQQQ / 10% defensive.',
        floorReason: null,
      });
    }

    return rows.slice().reverse();
  }, [backtest.initialState, filteredEvents, normalizedEnd, normalizedStart]);

  const effectiveTradeLogPageSize = tradeLogPageSize === 'all' ? Math.max(1, tradeLogRows.length) : tradeLogPageSize;
  const tradeLogPageCount = Math.max(1, Math.ceil(tradeLogRows.length / effectiveTradeLogPageSize));
  const safeTradeLogPage = Math.min(tradeLogPage, tradeLogPageCount);
  const pagedTradeLogRows = useMemo(() => {
    const startIndex = (safeTradeLogPage - 1) * effectiveTradeLogPageSize;
    return tradeLogRows.slice(startIndex, startIndex + effectiveTradeLogPageSize);
  }, [effectiveTradeLogPageSize, safeTradeLogPage, tradeLogRows]);
  const tradeLogVisibleStart = tradeLogRows.length === 0 ? 0 : (safeTradeLogPage - 1) * effectiveTradeLogPageSize + 1;
  const tradeLogVisibleEnd = tradeLogRows.length === 0
    ? 0
    : Math.min(safeTradeLogPage * effectiveTradeLogPageSize, tradeLogRows.length);

  useEffect(() => {
    setTradeLogPage((currentPage) => Math.min(currentPage, tradeLogPageCount));
  }, [tradeLogPageCount]);

  const athDdTriggerPct = current.ruleState.athDdTriggerPctOfAth;
  const refreshPhase = currentSingaporeRefreshPhase(current.marketTimestamp);
  const asOfLabel = refreshPhase === 'live-open' ? 'As Of ( Live Open )' : 'As Of ( Last Close )';
  const latestRebalanceEvent = backtest.rebalanceLog[backtest.rebalanceLog.length - 1];
  const currentAction = summarizeCurrentAction(current, latestRebalanceEvent);
  const tqqqRatio = current.portfolioValue > 0 ? (current.tqqqValue / current.portfolioValue) * 100 : 0;
  const defensiveRatio = current.portfolioValue > 0 ? (current.defensiveValue / current.portfolioValue) * 100 : 0;
  const sleeveSourceEvent = current.currentRebalanceEvent ?? latestRebalanceEvent;
  const sleeveTqqqValue = sleeveSourceEvent?.tqqqValue ?? current.tqqqValue;
  const sleeveDefensiveValue = sleeveSourceEvent?.defensiveValue ?? current.defensiveValue;
  const sleevePortfolioValue = sleeveTqqqValue + sleeveDefensiveValue;
  const sleeveTqqqRatio = sleevePortfolioValue > 0 ? (sleeveTqqqValue / sleevePortfolioValue) * 100 : 0;
  const sleeveDefensiveRatio = sleevePortfolioValue > 0 ? (sleeveDefensiveValue / sleevePortfolioValue) * 100 : 0;
  const targetBaseValue = current.tqqqTargetValue > 0 ? current.tqqqTargetValue / (1 + TARGET_GROWTH_GOAL_PCT / 100) : 0;
  const targetGrowthPct = targetBaseValue > 0 ? ((current.tqqqValue / targetBaseValue) - 1) * 100 : 0;
  const portfolioChangeTone = targetGrowthPct > 0 ? 'hit' : targetGrowthPct < 0 ? 'far' : 'hold';
  const defensiveLabel = current.defensiveAsset === 'SGOV' ? 'SGOV' : 'Cash';
  const rebalanceDaysRemaining = Math.max(
    0,
    differenceInCalendarDays(parseISO(current.nextRebalanceDate), parseISO(current.asOfDate)),
  );
  const visibleStart = filteredChartPoints[0]?.date ?? normalizedStart;
  const visibleEnd = filteredChartPoints[filteredChartPoints.length - 1]?.date ?? normalizedEnd;
  const skipSellDaysDisplay = current.ruleState.athDdActive ? String(current.ruleState.skipSellDaysRemaining) : 'N/A';
  const hasAthDdTrigger = Boolean(current.ruleState.athDdTriggerDate);

  return (
    <>
      <section>
        <h2>Current Status</h2>
        <DailyRefreshCountdown
          initialNowMs={current.marketTimestamp}
          staleMarketData={staleMarketData}
          nextRetryAtMs={nextRetryAtMs}
          onRefreshNeeded={onRefreshNeeded}
        />
        <p className="small" style={{ marginTop: '.2rem', marginBottom: '.75rem' }}>
          Days Until Next Rebalance: <strong>{rebalanceDaysRemaining}</strong> {rebalanceDaysRemaining === 1 ? 'day' : 'days'}
        </p>
        <p className="small" style={{ marginTop: '.35rem', marginBottom: '.75rem' }}>
          <strong>Execution Basis:</strong> Rebalance calculations use the dataset&apos;s same-day market open prices on rebalance dates.
        </p>
        <div className="grid status-grid">
          <div className="card">
            <strong>{asOfLabel}</strong>
            <div className="card-value">{current.asOfDate}</div>
          </div>
          <div className="card">
            <strong>Portfolio</strong>
            <div className="card-value">{fmtCurrency(current.portfolioValue)}</div>
            <div className={`card-note card-note-${portfolioChangeTone}`}>
              <div>{fmtPercent(targetGrowthPct)}</div>
            </div>
          </div>
          <div className="card">
            <strong>Last Rebalance</strong>
            <div className="card-value">{currentAction.value}</div>
            <div className={`card-note card-note-${currentAction.tone}`}>
              <div>{currentAction.detail}</div>
            </div>
          </div>
          <div className="card">
            <strong>Next Rebalance</strong>
            <div className="card-value">{current.nextRebalanceDate}</div>
          </div>
          <div className="card">
            <strong>TQQQ Sleeve Allocation</strong>
            <div className="card-value">{fmtPercent(sleeveTqqqRatio)}</div>
          </div>
          <div className="card">
            <strong>{defensiveLabel} Sleeve Allocation</strong>
            <div className="card-value">{fmtPercent(sleeveDefensiveRatio)}</div>
          </div>
          <div className="card">
            <strong>ATH DD Rule</strong>
            <div className="card-value">{current.ruleState.athDdActive ? 'Skip Active' : 'Inactive'}</div>
            <div className={`card-note ${current.ruleState.athDdActive ? 'card-note-far' : ''}`}>
              <div>Skip Sell Countdown: {skipSellDaysDisplay}</div>
            </div>
          </div>
        </div>
        <div className="status-badges">
          <span className={`badge badge-stack ${current.ruleState.athDdActive ? 'good' : 'bad'}`}>
            <span className="badge-stack-top">
              <span className="badge-stack-head">
                {hasAthDdTrigger
                  ? `Latest Skip-Sell Trigger: ${fmtPercent(athDdTriggerPct)} of ATH Close`
                  : 'Latest Skip-Sell Trigger: N/A'}
              </span>
              {hasAthDdTrigger ? (
                <>
                  <span className="badge-stack-detail">
                    {`→ ${current.ruleState.athDdTriggerDate}: ${fmtCurrency(current.ruleState.athDdTriggerClose)} Close`}
                  </span>
                  <span className="badge-stack-detail">
                    {`→ ${current.ruleState.athDdTriggerAthCloseDate}: ${fmtCurrency(current.ruleState.athDdTriggerAthClose)} Rolling ATH Close`}
                  </span>
                </>
              ) : (
                <span className="badge-stack-detail">
                  {"→ No trigger yet: each day's confirmed close is checked against the highest confirmed close inside that day's own trailing 315-trading-day window"}
                </span>
              )}
            </span>
          </span>
          <span className={`badge ${current.ruleState.floorTriggered ? 'good' : 'bad'}`}>
            Floor: {String(current.ruleState.floorTriggered)} ( TQQQ {fmtPercent(tqqqRatio)} / {defensiveLabel} {fmtPercent(defensiveRatio)} )
          </span>
        </div>
      </section>

      <section>
        <div className="section-header">
          <div>
            <h2>Backtest Summary ( $10,000 Model )</h2>
            <p className="small">Summary cards cover the finalised PhoenixSig strategy with a 15% next-quarter TQQQ target. The date controls below change the chart and historical trade log.</p>
          </div>
        </div>

        <div className="summary-block">
          <h3>PhoenixSig</h3>
          <div className="grid">
            <div className="card">
              <strong>Final Value</strong>
              <div className="card-value">{fmtCurrency(backtest.metrics.finalValue)}</div>
            </div>
            <div className="card">
              <strong>CAGR</strong>
              <div className="card-value">{fmtPercent(backtest.metrics.cagr)}</div>
            </div>
            <div className="card">
              <strong>Max Drawdown</strong>
              <div className="card-value">{fmtPercent(backtest.metrics.maxDrawdown)}</div>
            </div>
            <div className="card">
              <strong>Rebalances</strong>
              <div className="card-value">{backtest.metrics.rebalanceCount}</div>
            </div>
          </div>
        </div>

        <div className="summary-block">
          <h3>Buy &amp; Hold ( TQQQ )</h3>
          <div className="grid">
            <div className="card">
              <strong>Final Value</strong>
              <div className="card-value">{fmtCurrency(backtest.metrics.buyHoldFinalValue)}</div>
            </div>
            <div className="card">
              <strong>CAGR</strong>
              <div className="card-value">{fmtPercent(backtest.metrics.buyHoldCagr)}</div>
            </div>
            <div className="card">
              <strong>Max Drawdown</strong>
              <div className="card-value">{fmtPercent(backtest.metrics.buyHoldMaxDrawdown)}</div>
            </div>
            <div className="card">
              <strong>Rebalances</strong>
              <div className="card-value">0</div>
            </div>
          </div>
        </div>

        <div className="subsection-divider" />

        <h2 className="subsection-heading">Equity Curve vs Buy &amp; Hold</h2>

        <div className="range-controls">
          <label htmlFor="range-select">
            Range Preset
            <select
              id="range-select"
              value={range}
              onChange={(event) => {
                const nextRange = event.target.value as Range;
                if (nextRange === 'custom') {
                  setRange('custom');
                  return;
                }
                applyPreset(nextRange);
              }}
            >
              <option value="3m">3M</option>
              <option value="6m">6M</option>
              <option value="1y">1Y</option>
              <option value="3y">3Y</option>
              <option value="5y">5Y</option>
              <option value="all">All</option>
              <option value="custom">Custom</option>
            </select>
          </label>
          <label htmlFor="start-date">
            Start Date
            <input
              id="start-date"
              type="date"
              min={minDate}
              max={maxDate}
              value={startDate}
              onChange={(event) => {
                setRange('custom');
                setStartDate(clampDate(event.target.value, minDate, maxDate));
              }}
            />
          </label>
          <label htmlFor="end-date">
            End Date
            <input
              id="end-date"
              type="date"
              min={minDate}
              max={maxDate}
              value={endDate}
              onChange={(event) => {
                setRange('custom');
                setEndDate(clampDate(event.target.value, minDate, maxDate));
              }}
            />
          </label>
        </div>

        <p className="small">
          Showing chart and trade log from {format(parseISO(visibleStart), 'MMM d, yyyy')} to {format(parseISO(visibleEnd), 'MMM d, yyyy')}.
        </p>

        <PerformanceChart series={filteredChartPoints} />

        <div className="subsection-divider" />
        <div className="section-header">
          <div>
            <h2>Historical Trade Log</h2>
            <p className="small">
              Showing {tradeLogVisibleStart}-{tradeLogVisibleEnd} of {tradeLogRows.length} transactions in the selected date range.
            </p>
          </div>
          <div className="trade-log-toolbar">
            <label htmlFor="trade-log-page-size" className="trade-log-page-size">
              Rows Per Page
              <select
                id="trade-log-page-size"
                value={tradeLogPageSize}
                onChange={(event) => {
                  const nextValue = event.target.value === 'all' ? 'all' : Number(event.target.value);
                  setTradeLogPageSize(nextValue as TradeLogPageSize);
                  setTradeLogPage(1);
                }}
              >
                {TRADE_LOG_PAGE_SIZES.map((size) => (
                  <option key={size} value={size}>{size === 'all' ? 'All' : size}</option>
                ))}
              </select>
            </label>
            <div className="trade-log-pagination" aria-label="Historical Trade Log Pagination">
              <button
                type="button"
                className="subtle-button"
                onClick={() => setTradeLogPage((currentPage) => Math.max(1, currentPage - 1))}
                disabled={safeTradeLogPage <= 1 || tradeLogRows.length === 0}
              >
                Previous
              </button>
              <span className="small trade-log-page-label">Page {safeTradeLogPage} of {tradeLogPageCount}</span>
              <button
                type="button"
                className="subtle-button"
                onClick={() => setTradeLogPage((currentPage) => Math.min(tradeLogPageCount, currentPage + 1))}
                disabled={safeTradeLogPage >= tradeLogPageCount || tradeLogRows.length === 0}
              >
                Next
              </button>
            </div>
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th className="trade-log-action-column">Action</th>
                <th className="trade-log-value-column">TQQQ Value</th>
                <th className="trade-log-defensive-column">Defensive Value</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {pagedTradeLogRows.length > 0 ? (
                pagedTradeLogRows.map((row) => (
                  <tr key={row.id}>
                    <td className="nowrap">{row.date}</td>
                    <td className="trade-log-action-cell">{row.actionLabel}</td>
                    <td className="trade-log-value-cell">{fmtCurrency(row.tqqqValue)}</td>
                    <td className="trade-log-defensive-cell">{fmtCurrency(row.defensiveValue)}</td>
                    <td>
                      <div>{row.reason}</div>
                      {row.floorReason ? <div className="small" style={{ marginTop: '.25rem' }}>{row.floorReason}</div> : null}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="empty-state" colSpan={5}>No transactions in the selected range.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
