# 9Sig Web on 107

## Application and access

- Host: `harry-Precision-3660`, LAN IP `192.168.124.107`.
- Workspace: `/home/harry/swork/stock/9sig-backtest` (independent Git root).
- Application: `http://192.168.124.107:8910/`.
- Interactive walkthrough: `http://192.168.124.107:8910/?demo=1`.
- Illustrated guide: `http://192.168.124.107:8910/guide`.
- Health: `http://192.168.124.107:8910/healthz`.

This is a LAN deployment; use the same LAN or an existing route into that LAN.
No router WAN forwarding or public domain is configured by this deployment.

The dedicated Compose project `9sig-backtest` publishes only LAN address
`192.168.124.107:8910` to the container's port 8000. It runs Flask through Gunicorn
(2 workers × 2 threads), with a read-only root filesystem, non-root UID 10001,
bounded memory/CPU/PIDs/logs and an in-memory `/tmp`. `restart: unless-stopped`
restores it after Docker restarts. There is no persistent volume or database.
The running app does not depend on the local development server or a terminal.

The original engine is unchanged. The adapter validates input, explains actual
engine decisions, calculates time-based CAGR and suppresses the CLI engine's
portfolio-amount logs. Sample prices are deterministic synthetic input. Uploaded
CSV exists only in request memory. The image's build allowlist excludes Git
metadata, local data, test evidence, private files and unrelated stock projects.

## Build and deploy

From the project root, first inspect port 8910 and the existing service state:

```sh
ss -ltn '( sport = :8910 )'
docker compose -p 9sig-backtest -f compose.web.yaml ps
```

Run regression checks as described in `test/web/README.md`. Refresh guide
screenshots against a local test server only when the UI changes. Build a new,
unique tag, record its exact image ID, then deploy only this Compose service:

```sh
export RELEASE_ID=$(date -u +%Y%m%dT%H%M%SZ)
docker compose -p 9sig-backtest -f compose.web.yaml build web
docker image inspect "9sig-backtest-web:$RELEASE_ID" --format '{{.Id}}'
docker compose -p 9sig-backtest -f compose.web.yaml up -d --no-build --wait --wait-timeout 60 web
curl --fail --noproxy '*' http://192.168.124.107:8910/healthz
```

`BIND_IP` and `PORT` optionally override the LAN binding. Never claim WAN access
from a same-host request. Verify from a second LAN machine and execute the
browser acceptance against the deployed URL. Keep normal browser security and
the local Chrome policy wrapper.

Before replacing an existing release, record its tag/image ID and keep that
image. For a release, retain the source hashes, Python package list, image ID,
container state, response checks, and test report. Do not use blanket Docker
cleanup or restart unrelated services. The release report in this directory
records the actually deployed tag and acceptance evidence.

## Service operations

```sh
docker compose -p 9sig-backtest -f compose.web.yaml ps
docker compose -p 9sig-backtest -f compose.web.yaml logs --tail 60 web
docker compose -p 9sig-backtest -f compose.web.yaml restart web
```

To check the actual image independently of the shell's `RELEASE_ID`:

```sh
docker inspect 9sig-backtest-web-1 --format '{{.Config.Image}} {{.Image}} {{.State.Health.Status}}'
```

## Rollback

Set `RELEASE_ID` to the **previous recorded tag**, then run `up` with `--no-build`;
the previous image must still exist. Do not reuse a new source build under an old
tag. Verify health and a complete demo run after rollback:

```sh
RELEASE_ID=PREVIOUS_RECORDED_TAG docker compose -p 9sig-backtest -f compose.web.yaml up -d --no-build --wait web
```

For the first installation there is no earlier web release. Removing only this
project restores the pre-install state:

```sh
docker compose -p 9sig-backtest -f compose.web.yaml down
```

This does not remove source files or affect other Compose projects. Port 80
Apache, port 8899 Vibe-Trading, Kafka, ClickHouse and VPN services are outside this
application's deployment scope.
