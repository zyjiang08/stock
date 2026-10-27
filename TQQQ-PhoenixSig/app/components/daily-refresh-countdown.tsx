'use client';

import { useRouter } from 'next/navigation';
import { useRef } from 'react';
import { useEffect, useState } from 'react';
import { currentSingaporeRefreshKey, msUntilNextSingaporeRefresh, nextSingaporeRefreshTimeMs } from '@/lib/time/singapore-refresh';

const formatMs = (ms: number): string => {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};

type Props = {
  initialNowMs: number;
  staleMarketData: boolean;
  nextRetryAtMs: number | null;
};

const formatTime = (ms: number): string => {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return `${hours}h ${String(minutes).padStart(2, '0')}m`;
};

const formatSingaporeRefreshTime = (ms: number): string =>
  new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Singapore',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
    .format(new Date(ms))
    .toUpperCase();

export function DailyRefreshCountdown({ initialNowMs, staleMarketData, nextRetryAtMs }: Props) {
  const router = useRouter();
  const [remainingMs, setRemainingMs] = useState(() => msUntilNextSingaporeRefresh(initialNowMs));
  const [nextRefreshAtMs, setNextRefreshAtMs] = useState(() => nextSingaporeRefreshTimeMs(initialNowMs));
  const refreshKeyRef = useRef(currentSingaporeRefreshKey(initialNowMs));
  const lastRetryTriggerRef = useRef<number | null>(null);

  useEffect(() => {
    lastRetryTriggerRef.current = null;
  }, [nextRetryAtMs]);

  useEffect(() => {
    setRemainingMs(msUntilNextSingaporeRefresh());
    setNextRefreshAtMs(nextSingaporeRefreshTimeMs());
    refreshKeyRef.current = currentSingaporeRefreshKey();

    const timer = setInterval(() => {
      setRemainingMs(msUntilNextSingaporeRefresh());
      setNextRefreshAtMs(nextSingaporeRefreshTimeMs());
      const nextRefreshKey = currentSingaporeRefreshKey();
      if (nextRefreshKey !== refreshKeyRef.current) {
        refreshKeyRef.current = nextRefreshKey;
        router.refresh();
      }

      if (
        staleMarketData
        && nextRetryAtMs
        && Date.now() >= nextRetryAtMs
        && lastRetryTriggerRef.current !== nextRetryAtMs
      ) {
        lastRetryTriggerRef.current = nextRetryAtMs;
        router.refresh();
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [nextRetryAtMs, router, staleMarketData]);

  return (
    <p
      className="small"
      style={{ marginTop: '.6rem' }}
    >
      Next Dataset Refresh In: <strong>{formatMs(remainingMs)}</strong>{' '}
      <span>( <strong>{formatSingaporeRefreshTime(nextRefreshAtMs)} SGT</strong> )</span>
      {staleMarketData && nextRetryAtMs ? (
        <>
          <br />
          <span>
            Live market fetch failed. Using cached data and retrying in{' '}
            <strong>{formatTime(nextRetryAtMs - Date.now())}</strong>.
          </span>
        </>
      ) : null}
    </p>
  );
}
