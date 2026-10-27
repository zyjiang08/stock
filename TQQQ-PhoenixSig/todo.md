# PhoenixSig Migration TODO

## Database & Storage
- [x] Add telegram_subscribers table to drizzle schema
- [x] Add alert_sent_keys table to drizzle schema
- [x] Add strategy_cache table to drizzle schema (LONGTEXT column fix applied)
- [x] Run SQL migration for all new tables

## Server - Core Logic Ports
- [x] Port lib/strategy/engine.ts, calendar.ts, types.ts, service.ts to server/strategy/
- [x] Port lib/data/yahoo.ts and cache.ts to server/data/
- [x] Port lib/telegram/client.ts to server/telegram/
- [x] Port lib/time/singapore-refresh.ts to server/time/
- [x] Add TELEGRAM_BOT_TOKEN and JOB_RUNNER_SECRET to env

## tRPC API Routes
- [x] strategy.current procedure (fetch current snapshot)
- [x] strategy.backtest procedure (fetch backtest data)
- [x] telegram.sync procedure (poll updates, subscribe/unsubscribe)
- [x] telegram.disconnect procedure (protected, disconnect latest subscriber)
- [x] telegram.test procedure (send test message to connected chat)
- [x] telegram.status procedure (get connection status for current user)
- [x] jobs.rebalanceAlerts procedure (run rebalance alert job, secret-protected)
- [x] telegram.webhook POST endpoint (receive bot commands /start /stop)

## Frontend
- [x] Dashboard page: current portfolio status, next rebalance date, stale data warning
- [x] Performance chart with date range selector (SVG-based, original code)
- [x] Historical trade log table with pagination
- [x] Strategy rules section
- [x] Telegram connection controls (connect/test/disconnect) with Manus OAuth
- [x] Disclaimer & FAQ section
- [x] Original PhoenixSig aesthetic (globals.css injected, Playfair Display + DM Sans fonts)

## Deployment & Config
- [x] Set TELEGRAM_BOT_TOKEN secret (verified @Manus_TQQQ_SellCall_Bot)
- [x] Set JOB_RUNNER_SECRET secret
- [x] Register Telegram webhook pointing to live domain (https://phoenixsig.manus.space/api/telegram/webhook)
- [x] Schedule quarterly cron job — runs daily at 9:40 AM ET, self-gates on first US biz day of quarter
- [x] Final checkpoint and publish (https://phoenixsig.manus.space)

## Bug Fixes
- [x] Fix deployment: add date-holidays to production dependencies (was missing, caused ERR_MODULE_NOT_FOUND on startup)

## SEO
- [x] Fix page title (currently 10 chars, needs 30-60)
- [x] Add meta description (50-160 chars)
- [x] Add meta keywords

## UI Bugs
- [x] Remove white box at top of page
- [x] Fix hero layout: buttons overflow and cover PhoenixSig title on smaller widths
- [x] Fix Check Connection: fails with "webhook mode" error — must use DB lookup not polling
- [x] Fix Check Connection: shows "Telegram has not sent a usable /start update yet" even though DB has active subscriber — openId not linked on webhook /start
- [x] Fix white box at top of page — Sonner toaster container (GitHub commit 2c96733 fix applied)

## Cleanup
- [x] Remove outdated Next.js route tests (telegram-route, telegram-sync-route, telegram-disconnect-route, rebalance-alert-route)
- [x] Sync sonner.tsx from GitHub authoritative copy
- [ ] Fix strategy_cache payload column to longtext
- [ ] Run pnpm dedupe to fix lockfile phantom TS error
