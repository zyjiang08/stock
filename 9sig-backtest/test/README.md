# 9Sig regression tests

Web application coverage lives in [web/README.md](web/README.md). It checks the
original Python engine integration, CSV validation, financial invariants, browser
operations, the interactive walkthrough, downloads, and mobile layout.
Rebalance coverage includes rule counters, ordinary and proportional targets,
cash-flow conservation, buy-direction resets and the five-step browser process.
The cash comparison cases cover independent 40/50/60% cash strategies, shared
inputs, return/drawdown calculations, interactive curves and comparison export.
Frequency coverage includes 3/6/12-month decision dates, period target conversion,
shared quarterly drawdowns, nine scenarios, three tables and their CSV export.

Run from the **9sig-backtest Git root**. Summaries belong in
`test/web/reports/`; raw evidence belongs in `test/web/results/<UTC-run-id>/`
(ignored, directories mode 0700 and files mode 0600).
