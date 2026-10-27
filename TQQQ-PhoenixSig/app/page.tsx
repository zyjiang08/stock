import { getStrategyPayloads } from '@/lib/strategy/service';
import { getLatestActiveSubscriber } from '@/lib/db/store';
import { telegramBotConfigured, telegramConnectUrl } from '@/lib/telegram/client';
import { getCurrentAuthUser } from '@/lib/auth/server';
import { StrategyDashboard } from './components/strategy-dashboard';
import { TelegramConnectionControls } from './components/telegram-connection-controls';

export const dynamic = 'force-dynamic';

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
      ['Execution Basis', 'Daily refresh is standardised to Live Open and Last Close windows; intraday views use same-day market open prices from the dataset'],
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

export default async function HomePage() {
  const [{ current, backtest, staleMarketData, nextRetryAtMs }, authUser] = await Promise.all([
    getStrategyPayloads(),
    getCurrentAuthUser(),
  ]);
  const isAuthenticated = Boolean(authUser);
  const hasBotToken = telegramBotConfigured();
  const connectedSubscriber = isAuthenticated ? await getLatestActiveSubscriber() : null;
  const connectUrl = isAuthenticated && hasBotToken ? await telegramConnectUrl() : null;

  return (
    <main>
      <section className="hero">
        <div className="hero-copy">
          <h1>PhoenixSig ( Shares-Only )</h1>
          <p className="small">Quarterly rebalance model with a 15% next-quarter TQQQ target, ATH drawdown sell-skip, and floor reset controls.</p>
        </div>
        <TelegramConnectionControls
          botConfigured={hasBotToken}
          connectUrl={connectUrl}
          initiallyConnected={Boolean(connectedSubscriber)}
          isAuthenticated={isAuthenticated}
          signInUrl="/login-required?next=/"
        />
      </section>

      <StrategyDashboard
        current={current}
        backtest={backtest}
        staleMarketData={staleMarketData}
        nextRetryAtMs={nextRetryAtMs}
      />

      <section>
        <h2>Full Strategy Rules</h2>
        <p className="small" style={{ marginBottom: '.35rem' }}>Same rules, just rewritten in the compact table style.</p>
        <div className="rules-board">
          {STRATEGY_RULE_SECTIONS.map((section) => (
            <table className="rules-table" key={section.title}>
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
          ))}
        </div>
      </section>

      <section>
        <h2>Disclaimer & FAQ</h2>
        <ul>
          <li>This is a model strategy signal service only, not financial advice.</li>
          <li>Signals are generated from Yahoo Finance market data, and PhoenixSig uses same-day market open prices from that dataset for rebalance calculations.</li>
          <li>Actual broker fills can differ from the dataset open price and from the model output.</li>
          <li>All alerts are based on a fixed $10,000 model portfolio and are not personalised to individual users.</li>
          <li>This is a modified self-interpreted version of Jason Kelly's TQQQ 9Sig system from online sources.</li>
        </ul>
      </section>
    </main>
  );
}
