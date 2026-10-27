# PhoenixSig

PhoenixSig is a Vite + React + Express/tRPC app for the shares-only PhoenixSig model. It is a modified self-interpreted version of Jason Kelly's TQQQ 9Sig system from online sources.

It includes:
- a public strategy dashboard
- Telegram connection controls for signed-in users
- JSON compatibility endpoints for strategy data and alert jobs
- a quarterly rebalance alert fan-out job

The strategy source of truth lives in [STRATEGY.md](./STRATEGY.md).

## Quick Start

### Install

Preferred:

```bash
pnpm install
```

Also works:

```bash
npm install
```

Then create your local env file:

```bash
copy .env.example .env.local
```

### Configure `.env.local`

Minimum dashboard-only local setup:

```bash
JOB_RUNNER_SECRET=replace-with-strong-secret
```

Recommended full setup:

```bash
DATABASE_URL=
JWT_SECRET=
OAUTH_SERVER_URL=
VITE_APP_ID=
VITE_OAUTH_PORTAL_URL=
VITE_AUTH_LOGIN_URL=https://manus.im
TELEGRAM_BOT_TOKEN=
JOB_RUNNER_SECRET=replace-with-strong-secret
OWNER_OPEN_ID=
```

What each value is for:
- `DATABASE_URL`: required for user records, Telegram subscriber storage, and app state
- `JWT_SECRET`: required for signing the session cookie after OAuth login
- `OAUTH_SERVER_URL`: server-side OAuth API base URL used by the callback flow
- `VITE_APP_ID`: Manus/WebDev app ID used by both the client login link and the server OAuth exchange
- `VITE_OAUTH_PORTAL_URL`: client-side OAuth portal base URL used to build the `/app-auth` sign-in link
- `VITE_AUTH_LOGIN_URL`: optional safe fallback login URL if the full OAuth env is not configured yet
- `TELEGRAM_BOT_TOKEN`: BotFather token for connect, test-send, webhook, and alert delivery
- `JOB_RUNNER_SECRET`: protects the quarterly alert trigger endpoint
- `OWNER_OPEN_ID`: optional admin owner ID

Optional analytics envs to remove build warnings:

```bash
VITE_ANALYTICS_ENDPOINT=
VITE_ANALYTICS_WEBSITE_ID=
```

### Run

```bash
npm run dev
```

Open `http://localhost:3000`.

## How The App Behaves

- The dashboard is public
- Telegram actions require a signed-in user
- OAuth login sets a signed session cookie through `GET /api/oauth/callback`
- The app server is Express
- The frontend talks to the server through tRPC at `POST /api/trpc`
- Legacy JSON routes still exist for compatibility

## Telegram Setup

### Hosted / real deployment

1. Create your bot with BotFather.
2. Put the token into `TELEGRAM_BOT_TOKEN`.
3. Configure `DATABASE_URL`.
4. Sign in through the app.
5. Click `Connect Telegram`.
6. Open the bot and send `/start`.
7. Once connected, use `Send Test Message`.

Notes:
- `/start` connects the current Telegram chat
- `/stop` disconnects the current Telegram chat
- Webhook target: `POST /api/telegram/webhook`

### Localhost note

Telegram cannot call a plain `localhost` webhook from the public internet.

That means:
- the public dashboard works locally
- the sign-in UI can render locally
- the actual Telegram `/start` connection flow needs a public callback target

For real Telegram connection testing, use one of these:
- your deployed Manus site
- a tunnel such as ngrok or Cloudflare Tunnel pointed at local `POST /api/telegram/webhook`

`Check Connection` only refreshes the existing database link. It does not poll Telegram directly.

## Quarterly Alert Trigger

PhoenixSig is designed for one server-side trigger that fans out alerts to all connected users.

Trigger endpoint:

```text
POST /api/jobs/rebalance-alerts/run
Header: x-job-key: YOUR_JOB_RUNNER_SECRET
```

Recommended timing:
- first US business day of `Jan / Apr / Jul / Oct`
- shortly after US market open
- good default: `9:40 AM America/New_York`

Example instruction for Manus:

```text
Send one HTTP POST request to https://YOUR-DOMAIN/api/jobs/rebalance-alerts/run with header x-job-key set to the saved job runner secret. PhoenixSig will decide whether a rebalance alert is due and, if due, send it to all connected users.
```

## Deploy

- Deploy as one Node service
- Build with `npm run build`
- Start with `npm run start`
- Configure the same env vars in your host secrets
- Point Telegram webhook delivery to `POST /api/telegram/webhook`
- Schedule the quarterly alert trigger against `POST /api/jobs/rebalance-alerts/run`
- Keep persistent database storage for users, subscribers, and app state

## Main API Surface

tRPC:
- `POST /api/trpc`

Legacy JSON compatibility routes:
- `GET /api/strategy/current`
- `GET /api/strategy/backtest`
- `POST /api/jobs/rebalance-alerts/run`

Telegram / OAuth routes:
- `GET /api/oauth/callback`
- `POST /api/telegram/webhook`

## Verify

```bash
npm run check
npm run test
npm run build
npm audit --json
pnpm audit --json
```

## Strategy Reference

The exact PhoenixSig rulebook, assumptions, and precedence order live in [STRATEGY.md](./STRATEGY.md).
