# 9Sig regression tests

Web application coverage lives in [web/README.md](web/README.md). It checks the
original Python engine integration, CSV validation, financial invariants, browser
operations, the interactive walkthrough, downloads, and mobile layout.
Rebalance coverage includes rule counters, ordinary and proportional targets,
cash-flow conservation, buy-direction resets and the five-step browser process.

Run from the **9sig-backtest Git root**. Summaries belong in
`test/web/reports/`; raw evidence belongs in `test/web/results/<UTC-run-id>/`
(ignored, directories mode 0700 and files mode 0600).
