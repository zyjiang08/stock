'use client';

import { format, parseISO } from 'date-fns';
import { useMemo, useRef, useState } from 'react';

export type ChartPoint = {
  date: string;
  strategyValue: number;
  buyHoldValue: number;
};

type Props = {
  series: ChartPoint[];
};

type PlotPoint = {
  x: number;
  y: number;
};

const WIDTH = 920;
const HEIGHT = 320;
const PAD_TOP = 28;
const PAD_BOTTOM = 42;
const PAD_LEFT = 58;
const PAD_RIGHT = 14;
const GRID_STEPS = 5;
const STRATEGY_COLOR = '#1a3d2f';
const TQQQ_COLOR = '#bf8a30';
const MIN_ZOOM = 0.75;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.25;

const fmt = (n: number): string => `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const fmtAxis = (n: number): string => {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(n >= 100_000 ? 0 : 1)}k`;
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
};
const plotWidth = WIDTH - PAD_LEFT - PAD_RIGHT;
const plotHeight = HEIGHT - PAD_TOP - PAD_BOTTOM;
const clampZoom = (zoom: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(zoom * 100) / 100));

const xForIndex = (index: number, length: number): number => {
  if (length <= 1) return PAD_LEFT + plotWidth / 2;
  return PAD_LEFT + (index / (length - 1)) * plotWidth;
};

const yForValue = (value: number, min: number, max: number): number => {
  const yRange = Math.max(1e-9, max - min);
  return HEIGHT - PAD_BOTTOM - ((value - min) / yRange) * plotHeight;
};

const toPlotPoints = (
  points: ChartPoint[],
  selector: (point: ChartPoint) => number,
  min: number,
  max: number,
): PlotPoint[] =>
  points.map((point, index) => ({
    x: xForIndex(index, points.length),
    y: yForValue(selector(point), min, max),
  }));

const toSmoothPath = (points: PlotPoint[]): string => {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;

  let path = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;

  for (let index = 0; index < points.length - 1; index += 1) {
    const previous = points[index - 1] ?? points[index];
    const current = points[index];
    const next = points[index + 1];
    const afterNext = points[index + 2] ?? next;

    const cp1x = current.x + (next.x - previous.x) / 6;
    const cp1y = current.y + (next.y - previous.y) / 6;
    const cp2x = next.x - (afterNext.x - current.x) / 6;
    const cp2y = next.y - (afterNext.y - current.y) / 6;

    path += ` C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${next.x.toFixed(2)} ${next.y.toFixed(2)}`;
  }

  return path;
};

const toAreaPath = (points: PlotPoint[]): string => {
  if (points.length === 0) return '';
  const baseY = HEIGHT - PAD_BOTTOM;
  const linePath = toSmoothPath(points);
  const first = points[0];
  const last = points[points.length - 1];
  return `${linePath} L ${last.x.toFixed(2)} ${baseY.toFixed(2)} L ${first.x.toFixed(2)} ${baseY.toFixed(2)} Z`;
};

export function PerformanceChart({ series }: Props) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [hoverPosition, setHoverPosition] = useState<{ x: number; y: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const chartShellRef = useRef<HTMLDivElement | null>(null);

  const chart = useMemo(() => {
    if (series.length === 0) {
      return {
        min: 0,
        max: 1,
        strategyPath: '',
        strategyAreaPath: '',
        buyHoldPath: '',
        buyHoldAreaPath: '',
        yTicks: [] as Array<{ value: number; y: number }>,
        xTicks: [] as Array<{ index: number; x: number; label: string }>,
      };
    }

    const allValues = series.flatMap((point) => [point.strategyValue, point.buyHoldValue]);
    const rawMin = Math.min(...allValues);
    const rawMax = Math.max(...allValues);
    const padding = Math.max(1, (rawMax - rawMin) * 0.08);
    const min = Math.max(0, rawMin - padding);
    const max = rawMax + padding;
    const xTickCount = Math.min(series.length > 500 ? 5 : 6, series.length);
    const xTickIndexes = Array.from(
      new Set(
        Array.from({ length: xTickCount }, (_, index) =>
          xTickCount === 1 ? 0 : Math.round((index * (series.length - 1)) / (xTickCount - 1)),
        ),
      ),
    );
    const labelFormat = series.length > 500 ? 'yyyy' : series.length > 260 ? 'MMM yyyy' : 'MMM d, yyyy';
    const strategyPoints = toPlotPoints(series, (point) => point.strategyValue, min, max);
    const buyHoldPoints = toPlotPoints(series, (point) => point.buyHoldValue, min, max);

    return {
      min,
      max,
      strategyPath: toSmoothPath(strategyPoints),
      strategyAreaPath: toAreaPath(strategyPoints),
      buyHoldPath: toSmoothPath(buyHoldPoints),
      buyHoldAreaPath: toAreaPath(buyHoldPoints),
      yTicks: Array.from({ length: GRID_STEPS }, (_, index) => {
        const value = max - ((max - min) * index) / (GRID_STEPS - 1);
        return {
          value,
          y: yForValue(value, min, max),
        };
      }),
      xTicks: xTickIndexes.map((index) => ({
        index,
        x: xForIndex(index, series.length),
        label: format(parseISO(series[index].date), labelFormat),
      })),
    };
  }, [series]);

  const activeIndex = hoverIndex ?? Math.max(series.length - 1, 0);
  const activePoint = series[activeIndex];
  const activeX = xForIndex(activeIndex, series.length);
  const strategyY = activePoint ? yForValue(activePoint.strategyValue, chart.min, chart.max) : PAD_TOP;
  const buyHoldY = activePoint ? yForValue(activePoint.buyHoldValue, chart.min, chart.max) : PAD_TOP;
  const zoomPercent = Math.round(zoom * 100);
  const showHoverState = hoverIndex !== null && Boolean(activePoint);
  const tooltipWidth = 222;
  const tooltipHeight = 74;
  const tooltipX = hoverPosition ? hoverPosition.x + 18 : 0;
  const tooltipY = hoverPosition ? Math.max(12, hoverPosition.y - (tooltipHeight / 2)) : 0;

  if (series.length === 0) {
    return (
      <div className="card">
        <p className="small" style={{ margin: 0 }}>No chart data in the selected range.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="chart-meta">
        <div className="chart-meta-row">
          <div style={{ display: 'flex', alignItems: 'center', gap: '.85rem', flexWrap: 'wrap' }}>
            <span className="small" style={{ display: 'inline-flex', alignItems: 'center', gap: '.45rem', margin: 0, color: STRATEGY_COLOR }}>
              <span
                aria-hidden="true"
                style={{ width: 10, height: 10, borderRadius: '999px', background: STRATEGY_COLOR, display: 'inline-block' }}
              />
              <strong style={{ fontWeight: 500 }}>PhoenixSig</strong>
            </span>
            <span className="small" style={{ display: 'inline-flex', alignItems: 'center', gap: '.45rem', margin: 0, color: TQQQ_COLOR }}>
              <span
                aria-hidden="true"
                style={{ width: 10, height: 10, borderRadius: '999px', background: TQQQ_COLOR, display: 'inline-block' }}
              />
              <strong style={{ fontWeight: 500 }}>Buy &amp; Hold ( TQQQ )</strong>
            </span>
          </div>
          <span className="small chart-instructions">Use the Zoom Controls to Adjust the View.</span>
        </div>
        <div className="chart-toolbar">
          <div className="chart-zoom-controls" aria-label="Equity Chart Zoom Controls">
            <button
              type="button"
              className="subtle-button chart-zoom-button"
              onClick={() => setZoom((currentZoom) => clampZoom(currentZoom - ZOOM_STEP))}
              disabled={zoom <= MIN_ZOOM}
            >
              -
            </button>
            <span className="small chart-zoom-label">Zoom {zoomPercent}%</span>
            <button
              type="button"
              className="subtle-button chart-zoom-button"
              onClick={() => setZoom((currentZoom) => clampZoom(currentZoom + ZOOM_STEP))}
              disabled={zoom >= MAX_ZOOM}
            >
              +
            </button>
            <button
              type="button"
              className="subtle-button chart-zoom-reset"
              onClick={() => setZoom(1)}
              disabled={zoom === 1}
            >
              Reset
            </button>
          </div>
        </div>
      </div>

      <div className="chart-shell" ref={chartShellRef}>
      <div className="card chart-card">
        <div className="chart-viewport">
          <svg
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            role="img"
            aria-label="PhoenixSig and TQQQ buy and hold equity chart"
            style={{ width: `${WIDTH * zoom}px`, height: `${HEIGHT * zoom}px` }}
            onMouseLeave={() => {
              setHoverIndex(null);
              setHoverPosition(null);
            }}
            onMouseMove={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              const shellRect = chartShellRef.current?.getBoundingClientRect() ?? rect;
              const svgX = ((event.clientX - rect.left) / rect.width) * WIDTH;
              const relativeX = Math.min(Math.max(svgX - PAD_LEFT, 0), plotWidth);
              const nextIndex = series.length <= 1 ? 0 : Math.round((relativeX / plotWidth) * (series.length - 1));
              setHoverIndex(nextIndex);
              setHoverPosition({
                x: event.clientX - shellRect.left,
                y: event.clientY - shellRect.top,
              });
            }}
          >
            <defs>
              <linearGradient id="strategyAreaGradient" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={STRATEGY_COLOR} stopOpacity="0.16" />
                <stop offset="100%" stopColor={STRATEGY_COLOR} stopOpacity="0.02" />
              </linearGradient>
              <linearGradient id="buyHoldAreaGradient" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={TQQQ_COLOR} stopOpacity="0.14" />
                <stop offset="100%" stopColor={TQQQ_COLOR} stopOpacity="0.015" />
              </linearGradient>
            </defs>
            <rect x={PAD_LEFT} y={PAD_TOP} width={plotWidth} height={plotHeight} rx="12" fill="#fcfaf5" />
            {chart.yTicks.map((tick) => (
              <g key={tick.value}>
                <line x1={PAD_LEFT} x2={WIDTH - PAD_RIGHT} y1={tick.y} y2={tick.y} stroke="#e4e0d8" strokeDasharray="4 6" />
                <text x={PAD_LEFT - 10} y={tick.y + 4} fontSize="12" fill="#7a7a75" textAnchor="end">
                  {fmtAxis(tick.value)}
                </text>
              </g>
            ))}
            {chart.xTicks.map((tick) => (
              <text key={tick.index} x={tick.x} y={HEIGHT - 12} fontSize="12" fill="#7a7a75" textAnchor="middle">
                {tick.label}
              </text>
            ))}
            <path d={chart.buyHoldAreaPath} fill="url(#buyHoldAreaGradient)" />
            <path d={chart.strategyAreaPath} fill="url(#strategyAreaGradient)" />
            <path d={chart.buyHoldPath} fill="none" stroke={TQQQ_COLOR} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <path d={chart.strategyPath} fill="none" stroke={STRATEGY_COLOR} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            {showHoverState ? (
              <>
                <line x1={activeX} x2={activeX} y1={PAD_TOP} y2={HEIGHT - PAD_BOTTOM} stroke="#c8b898" strokeDasharray="4 5" />
                <circle cx={activeX} cy={buyHoldY} r="4.5" fill={TQQQ_COLOR} />
                <circle cx={activeX} cy={strategyY} r="4.5" fill={STRATEGY_COLOR} />
              </>
            ) : null}
          </svg>
        </div>
      </div>
      {showHoverState && hoverPosition ? (
        <div
          className="chart-hover-tooltip"
          style={{
            width: `${tooltipWidth}px`,
            transform: `translate(${tooltipX}px, ${tooltipY}px)`,
          }}
        >
          <div className="chart-hover-tooltip-date">{format(parseISO(activePoint.date), 'MMM d, yyyy')}</div>
          <div className="chart-hover-tooltip-strategy">PhoenixSig: {fmt(activePoint.strategyValue)}</div>
          <div className="chart-hover-tooltip-benchmark">Buy &amp; Hold: {fmt(activePoint.buyHoldValue)}</div>
        </div>
      ) : null}
      </div>

    </div>
  );
}
