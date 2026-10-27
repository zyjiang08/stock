import { useCallback } from 'react';
import { trpc } from '../lib/trpc';
import { useAuth } from '../_core/hooks/useAuth';
import { getLoginUrl } from '../const';
import { StrategyDashboard } from '../components/StrategyDashboard';
import { TelegramConnectionControls } from '../components/TelegramConnectionControls';

const STRATEGY_RULE_SECTIONS = [
  {
    title: '1. Initial Allocation ( Only Initially, This Is Not Maintained )',
    rows: [
      ['Start', '90% TQQQ / 10% Defensive'],
      ['Defensive Sleeve', 'Cash until SGOV data exists, then SGOV'],
    ],
  },
  {
    title: '2. Quarterly Rebalance ( Jan / Apr / Jul / Oct )',
    rows: [
      ['Execution Basis', 'Rebalance calculations use the same-day market open prices from the dataset on the rebalance date'],
      ['Target', '15% target = Last quarter TQQQ balance x 1.15 ( updated quarterly )'],
      ['If Above', 'Sell excess down to 15% target -> Move excess to Defensive sleeve'],
      ['If Below', 'Draw funds from Defensive sleeve to 15% target'],
      ['Buy Cap', 'If Defensive sleeve does not have enough, buy as much as possible -> Can end at 100% TQQQ'],
      ['ATH DD', "On each trading day, take that day's confirmed TQQQ close and compare it against the highest confirmed TQQQ close inside that same day's trailing 315-trading-day window ( ~5 quarters ). If that day's close is < 70% of that day's rolling ATH close -> Skip TQQQ SELLS for 126 trading days ( ~2 quarters )"],
      ['ATH DD Refresh', "If later trading days are still < 70% of their own rolling 315-trading-day ATH close, the 126-day skip window refreshes forward again"],
      ['FLOOR', 'If TQQQ < 60% portfolio, reset to 60/40 TQQQ / Defensive allocation ( enforced only at quarterly rebalance )'],
      ['Final Step', 'The 15% next-quarter target is calculated last, after all rebalance adjustments are made'],
    ],
  },
] as const;

export default function Dashboard() {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const utils = trpc.useUtils();

  const dashboardQuery = trpc.strategy.dashboard.useQuery(undefined, { staleTime: 60_000 });
  const telegramQuery = trpc.telegram.status.useQuery(undefined, { staleTime: 30_000 });

  const handleRefreshNeeded = useCallback(() => {
    utils.strategy.dashboard.invalidate();
  }, [utils]);

  const handleConnected = useCallback(() => {
    utils.telegram.status.invalidate();
  }, [utils]);

  const handleDisconnected = useCallback(() => {
    utils.telegram.status.invalidate();
  }, [utils]);

  const isLoading = dashboardQuery.isLoading;
  const isError = dashboardQuery.isError;
  const bootLoading = authLoading || isLoading || telegramQuery.isLoading;

  if (bootLoading) {
    return (
      <main className="dashboard-shell dashboard-shell-loading">
        <section className="boot-splash">
          <div className="boot-splash-card">
            <p className="boot-splash-kicker">PhoenixSig</p>
            <h1>Loading Dashboard</h1>
            <p className="small">
              Fetching the latest strategy snapshot, Telegram status, and market data.
            </p>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="dashboard-shell">
      <section className="hero">
        <div className="hero-copy">
          <h1>PhoenixSig ( Shares-Only )</h1>
          <p className="small">Quarterly rebalance model with a 15% next-quarter TQQQ target, ATH drawdown sell-skip, and floor reset controls.</p>
        </div>
        <TelegramConnectionControls
          botConfigured={telegramQuery.data?.botConfigured ?? false}
          connectUrl={telegramQuery.data?.connectUrl ?? null}
          initiallyConnected={telegramQuery.data?.connected ?? false}
          isAuthenticated={isAuthenticated}
          loading={telegramQuery.isLoading || authLoading}
          signInUrl={getLoginUrl()}
          onConnected={handleConnected}
          onDisconnected={handleDisconnected}
        />
      </section>

      {isError && (
        <section>
          <p className="small" style={{ color: 'var(--negative)' }}>
            Failed to load strategy data. Please refresh the page.
          </p>
        </section>
      )}

      {!isError && dashboardQuery.data && (
        <StrategyDashboard
          current={dashboardQuery.data.current}
          backtest={dashboardQuery.data.backtest}
          staleMarketData={dashboardQuery.data.staleMarketData}
          nextRetryAtMs={dashboardQuery.data.nextRetryAtMs}
          onRefreshNeeded={handleRefreshNeeded}
        />
      )}

      <section>
        <h2>Full Strategy Rules</h2>
        <p className="small" style={{ marginBottom: '.35rem' }}>Same rules, just rewritten in the compact table style.</p>
        <div className="rules-board">
          {STRATEGY_RULE_SECTIONS.map((section) => (
            <div className="rules-table-wrap" key={section.title}>
              <table className="rules-table">
                <thead>
                  <tr>
                    <th colSpan={2}>{section.title}</th>
                  </tr>
                </thead>
                <tbody>
                  {section.rows.map(([label, detail]) => (
                    <tr key={`${section.title}-${label}`}>
                      <td className="rules-label">{label}</td>
                      <td className="rules-detail">{detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2>Disclaimer &amp; FAQ</h2>
        <ul>
          <li>This is a model strategy signal service only, not financial advice.</li>
          <li>Signals are generated from Yahoo Finance market data, and PhoenixSig uses same-day market open prices from that dataset for rebalance calculations.</li>
          <li>Actual broker fills can differ from the dataset open price and from the model output.</li>
          <li>All alerts are based on a fixed $10,000 model portfolio and are not personalised to individual users.</li>
        </ul>
      </section>

      <section>
        <h2>Support PhoenixSig</h2>
        <div className="support-note">
          <div className="support-note-copy">
            <p className="small">
              If the dashboard or Telegram alerts have been useful, you can help support ongoing upkeep and hosting.
            </p>
          </div>
          <a className="support-note-link" href="https://paypal.me/weijunswj" target="_blank" rel="noreferrer">
            Donate via PayPal
          </a>
        </div>
      </section>
    </main>
  );
}
