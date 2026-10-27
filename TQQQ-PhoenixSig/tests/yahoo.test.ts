import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rm, mkdir, writeFile } from 'node:fs/promises';
import { fetchDailyPrices, filterToConfirmedDailyCloses } from '@/lib/data/yahoo';
import { currentSingaporeRefreshKey } from '@/lib/time/singapore-refresh';

const cachePath = '.cache/yahoo-daily-v3.json';

afterEach(async () => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  await rm(cachePath, { force: true });
});

beforeEach(async () => {
  await rm(cachePath, { force: true });
});

describe('fetchDailyPrices', () => {
  it('Drops the current New York trading day candle until the daily close is confirmed.', () => {
    const points = [
      { date: '2026-03-30', open: 37.2, close: 37.89 },
      { date: '2026-03-31', open: 38.1, close: 38.22 },
    ];

    expect(filterToConfirmedDailyCloses(points, Date.parse('2026-03-31T13:35:00.000Z'))).toEqual([
      { date: '2026-03-30', open: 37.2, close: 37.89 },
    ]);
  });

  it('Keeps the current New York trading day candle after the close-confirmation buffer.', () => {
    const points = [
      { date: '2026-03-30', open: 37.2, close: 37.89 },
      { date: '2026-03-31', open: 38.1, close: 38.22 },
    ];

    expect(filterToConfirmedDailyCloses(points, Date.parse('2026-03-31T20:30:00.000Z'))).toEqual(points);
  });

  it('Throws when Yahoo payload result is missing.', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ chart: { result: [] } }) })) as unknown as typeof fetch);

    await expect(fetchDailyPrices()).rejects.toThrow(/missing result/i);
  });

  it('Throws when Yahoo payload has chart error.', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ chart: { error: { description: 'bad symbol' } } }) })) as unknown as typeof fetch,
    );

    await expect(fetchDailyPrices()).rejects.toThrow(/chart error/i);
  });

  it('Keeps the live session row separate from confirmed-close data during the New York session.', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-31T13:40:00.000Z'));

    const payload = {
      chart: {
        result: [
          {
            timestamp: [
              Math.floor(Date.parse('2026-03-30T13:30:00.000Z') / 1000),
              Math.floor(Date.parse('2026-03-31T13:30:00.000Z') / 1000),
            ],
            indicators: {
              quote: [
                {
                  open: [37.2, 38.1],
                  close: [37.89, 38.22],
                  high: [38.0, 38.3],
                },
              ],
            },
          },
        ],
      },
    };

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => payload })) as unknown as typeof fetch,
    );

    const result = await fetchDailyPrices();
    expect(result.data.TQQQ.map((point) => point.date)).toEqual(['2026-03-30']);
    expect(result.liveData.TQQQ.map((point) => point.date)).toEqual(['2026-03-30', '2026-03-31']);
  });

  it('Returns stale fallback metadata without rewriting cache key semantics.', async () => {
    await mkdir('.cache', { recursive: true });
    await writeFile(
      cachePath,
      JSON.stringify({
        key: '2026-03-27',
        data: {
          TQQQ: [{ date: '2026-03-27', open: 100, close: 101 }],
          SGOV: [{ date: '2026-03-27', open: 100, close: 100.1 }],
        },
      }),
      'utf-8',
    );
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })) as unknown as typeof fetch);

    const result = await fetchDailyPrices();
    expect(result.key).toBe('2026-03-27');
    expect(result.isStaleFallback).toBe(true);
    expect(typeof result.nextRetryAtMs).toBe('number');
  });

  it('Skips network fetch until backoff retry window expires.', async () => {
    const refreshKey = currentSingaporeRefreshKey();
    await mkdir('.cache', { recursive: true });
    await writeFile(
      cachePath,
      JSON.stringify({
        key: '2026-03-27',
        data: {
          TQQQ: [{ date: '2026-03-27', open: 100, close: 101 }],
          SGOV: [{ date: '2026-03-27', open: 100, close: 100.1 }],
        },
        retryState: {
          refreshKey,
          failureCount: 2,
          nextRetryAtMs: Date.now() + 30_000,
        },
      }),
      'utf-8',
    );

    const fetchSpy = vi.fn(async () => ({ ok: false }));
    vi.stubGlobal('fetch', fetchSpy as unknown as typeof fetch);

    const result = await fetchDailyPrices();
    expect(result.isStaleFallback).toBe(true);
    expect(result.nextRetryAtMs).not.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
