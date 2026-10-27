# Web application acceptance

The tested code is `src/web_app.py`, `web/`, and the unchanged engine in
`src/backtester.py`. This directory belongs to the independent `9sig-backtest`
repository, not the outer stock repository.

## API and calculation tests

Install `requirements-web.txt` in an isolated environment, or run in the web
container. From the project root:

```sh
python -m unittest discover -s test/web -p 'test_api.py' -v
```

Cases cover a manually calculated sell and buy, the 30 Down transition, exact
parity with the original engine, balance conservation, request isolation, actual
elapsed time for CAGR, CSV aliases/BOM/order, date/price/parameter validation,
truncated date ranges, request size, static-file isolation, and suppression of
portfolio amounts in persistent web logs. No network or
external data is required. Inputs are synthetic; no account is accessed.

Rebalance cases verify that ordinary quarterly targets do not reset to 60/40,
the last ignored sell triggers a reset in that same quarter, intervening buys
preserve the ignore count, both reset rules can buy, cash shortfalls have no
execution target, and custom allocations reconcile the displayed cash flows
and before/after values with the original engine.

## Browser acceptance

Use Node 20+ and Playwright (`npm install --no-save --prefix test/web playwright@1.63.0`),
with installed Chrome. On workstation 107, keep the policy wrapper:
`CHROME_BIN=/home/harry/.local/bin/google-chrome`.

Start a local test server if needed:

```sh
python -m flask --app src.web_app run --host 127.0.0.1 --port 8911
```

Run against this server, the deployed LAN address, or `http://183.23.140.51:8910`:

```sh
umask 077
RUN_ID=$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p "test/web/results/$RUN_ID"
BASE_URL=http://127.0.0.1:8911 \
RESULT_DIR="test/web/results/$RUN_ID" \
CHROME_BIN=/home/harry/.local/bin/google-chrome \
node test/web/test_browser.cjs
```

`PLAYWRIGHT_MODULE` optionally points at an existing Playwright installation.
`CAPTURE_GUIDE=1` explicitly refreshes `web/assets/demo-overview.png` and
`demo-quarter.png` and `demo-rebalance.png` using only the default synthetic dataset. Capture before
building the production image. The default test mode only writes ignored
evidence, never source assets.

The browser case opens the desktop workspace, checks the manual sell, switches
chart type, runs a 40% allocation, exports CSV, follows all six tour steps,
executes all five rebalance steps, checks the 30 Down sequence and 100 Up reset,
verifies no-trade and buy-direction cases, opens the direct rebalance link,
imports a valid fixture, rejects invalid data, verifies a failed request leaves
export disabled, reads the guide, and checks the mobile layout at 390px. It saves
screenshots and `browser-results.json`; errors yield a nonzero exit code.
Uploads stay in request memory. Tests do not modify any database, production
account, or saved user configuration. Close the test browser and stop the local
test server when done; preserve reports and evidence.

## Combined recorder

`python3 test/web/run_checks.py --base-url URL --stage local` runs both suites and
writes a dated Markdown report plus private raw logs and source hashes. Add
`--capture-guide` only when intentionally refreshing tutorial screenshots.
For production acceptance, use `--stage production --api-image IMAGE_TAG` to
run the API/calculation cases inside the exact built image with a read-only test
mount. The browser then exercises the supplied production URL. This command
does not deploy or modify the running container.
