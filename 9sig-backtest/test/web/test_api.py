"""Behavioral acceptance of the web adapter and original strategy engine."""

import math
import logging
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pandas as pd

from src.backtester import Backtester, DataHandler, Portfolio
from src.web_app import ROOT, app, config_from_json, metrics, parse_csv, run_backtest


class WebTests(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()

    def test_known_sell_and_buy(self):
        result = run_backtest({})
        sell, buy = result["rows"][1:3]
        self.assertEqual(sell["date"], "2019-03-31")
        for field, expected in {"etf_before": 75000, "target": 65400, "trade_shares": -192, "etf_shares": 1308, "cash_value": 49600, "total_value": 115000}.items():
            self.assertAlmostEqual(sell[field], expected, msg=field)
        self.assertAlmostEqual(buy["trade_amount"], 12426)
        self.assertAlmostEqual(buy["cash_value"], 37174)

    def test_thirty_down_and_reset_are_explained(self):
        rows = {r["date"]: r for r in run_backtest({})["rows"]}
        self.assertEqual(rows["2021-03-31"]["kind"], "drawdown")
        self.assertAlmostEqual(rows["2021-03-31"]["trade_shares"], 0)
        self.assertEqual(rows["2021-06-30"]["kind"], "skip")
        self.assertEqual(rows["2021-09-30"]["action"], "30-Down Complete & Rebalance")

    def test_web_matches_original_engine_for_two_allocations(self):
        frame, _, _ = parse_csv((ROOT / "data/demo_prices.csv").read_text())
        for allocation in (40, 60):
            raw = {"etf_allocation": allocation}
            config, _ = config_from_json(raw)
            original = Backtester(config, Portfolio(config), DataHandler()).run(frame, DataHandler.get_quarter_end_dates(frame))
            adapted = run_backtest({"config": raw})["rows"]
            for expected, actual in zip(original.to_dict("records"), adapted):
                self.assertEqual(expected["action"], actual["action"])
                for field in ("etf_shares", "etf_value", "cash_value", "total_value"):
                    self.assertAlmostEqual(expected[field], actual[field], msg=field)

    def test_assets_and_trades_conserve_value(self):
        for allocation in (1, 40, 60, 100):
            for row in run_backtest({"config": {"etf_allocation": allocation}})["rows"]:
                self.assertGreaterEqual(row["cash_value"], -1e-7)
                self.assertGreaterEqual(row["etf_shares"], -1e-7)
                self.assertAlmostEqual(row["total_value"], row["etf_value"] + row["cash_value"])
                self.assertAlmostEqual(row["total_value"], row["etf_before"] + row["cash_before"])
                self.assertAlmostEqual(row["cash_value"], row["cash_before"] - row["trade_amount"])

    def test_request_state_is_isolated(self):
        with ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(lambda capital: run_backtest({"config": {"initial_capital": capital}}), [10000, 20000, 10000, 20000]))
        self.assertEqual(results[0], results[2])
        self.assertEqual(results[1], results[3])
        self.assertAlmostEqual(results[1]["strategy"]["final_value"], results[0]["strategy"]["final_value"] * 2)

    def test_metrics_use_elapsed_days_and_initial_capital(self):
        summary, dd = metrics([80, 120], 100, 730.5)
        self.assertAlmostEqual(summary["total_return"], .2)
        self.assertAlmostEqual(summary["cagr"], math.sqrt(1.2) - 1)
        self.assertAlmostEqual(summary["max_drawdown"], -.2)
        self.assertAlmostEqual(dd[0], -.2)
        self.assertIsNone(metrics([110], 100, 90)[0]["cagr"])

    def test_bom_alias_precedence_and_sorting(self):
        frame, warnings, column = parse_csv("\ufeffDate,Close,Adj Close,Volume\n2024-06-30,99,50,100\n2024-03-31,88,40,200\n")
        self.assertEqual(column, "Adj Close")
        self.assertEqual(frame["ETF_Price"].tolist(), [40, 50])
        self.assertEqual(len(warnings), 2)

    def test_invalid_csv_is_rejected(self):
        invalid = [
            "Day,ETF_Price\n2024-03-31,40\n2024-06-30,50", "Date,X\n2024-03-31,40\n2024-06-30,50",
            "Date,ETF_Price\n2024-03-31,0\n2024-06-30,50", "Date,ETF_Price\n2024-03-31,nan\n2024-06-30,50",
            "Date,ETF_Price\n2024-03-31,inf\n2024-06-30,50", "Date,ETF_Price\n2024-03-31,40\n2024-03-31,50",
            "Date,ETF_Price\n2024-02-30,40\n2024-06-30,50", "Date,ETF_Price\n2024-03-31,40,100\n2024-06-30,50",
            'Date,ETF_Price\n2024-03-31,"40\n2024-06-30,50', "Date,ETF_Price,ETF_Price\n2024-03-31,40,40",
        ]
        for text in invalid:
            with self.subTest(text=text), self.assertRaises(ValueError):
                parse_csv(text)

    def test_invalid_parameters_are_rejected(self):
        for config in ({"initial_capital": 0}, {"initial_capital": True}, {"initial_capital": "10000"}, {"initial_capital": float("nan")}, {"etf_allocation": 0}, {"etf_allocation": 101}, {"lookback_quarters": 1.5}, {"ignore_sell_signals": 0}, {"drawdown_threshold": 100}, {"unknown": 1}):
            with self.subTest(config=config), self.assertRaises(ValueError):
                config_from_json(config)

    def test_date_range_filters_the_actual_dataset(self):
        result = run_backtest({"start_date": "2023-01-01", "end_date": "2024-12-31"})
        self.assertEqual(result["period"]["start"], "2023-03-31")
        self.assertEqual(result["period"]["quarters"], 8)
        self.assertAlmostEqual(result["rows"][0]["total_value"], 100000)
        for payload in ({"start_date": "2025-01-01", "end_date": "2024-01-01"}, {"start_date": "2024-10-01"}, {"start_date": "2024-02-30"}):
            with self.subTest(payload=payload), self.assertRaises(ValueError):
                run_backtest(payload)

    def test_partial_quarter_is_disclosed(self):
        result = run_backtest({"source": "upload", "csv": "Date,ETF_Price\n2024-03-28,40\n2024-04-01,41"})
        self.assertTrue(any("未完成季度" in w for w in result["warnings"]))

    def test_health_pages_sample_and_api(self):
        for path in ("/", "/guide", "/healthz", "/api/sample.csv", "/assets/app.js", "/assets/style.css"):
            with self.subTest(path=path):
                response = self.client.get(path)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.headers["X-Content-Type-Options"], "nosniff")
                response.close()
        result = self.client.post("/api/backtest", json={})
        self.assertEqual(result.status_code, 200)
        self.assertEqual(len(result.json["rows"]), 25)
        self.assertIn("模拟", result.json["source"]["label"])
        self.assertEqual(result.headers["Cache-Control"], "no-store")

    def test_api_rejects_invalid_or_oversized_bodies(self):
        for payload in ([], 1, {"source": "bad"}, {"config": None}, {"source": "upload", "csv": "bad"}):
            with self.subTest(payload=payload):
                response = self.client.post("/api/backtest", json=payload)
                self.assertEqual(response.status_code, 400)
                self.assertIn("error", response.json)
        response = self.client.post("/api/backtest", data=b"x" * (2 * 1024 * 1024 + 1), content_type="application/json")
        self.assertEqual(response.status_code, 413)
        self.assertIn("2 MiB", response.json["error"])

    def test_private_files_are_not_served(self):
        for path in ("/.git/config", "/src/backtester.py", "/requirements-web.txt", "/assets/../../src/backtester.py", "/data/source.txt"):
            with self.subTest(path=path):
                self.assertEqual(self.client.get(path).status_code, 404)

    def test_uploaded_portfolio_amounts_are_not_logged(self):
        records = []
        class Capture(logging.Handler):
            def emit(self, record):
                records.append(record)
        handler = Capture()
        logging.getLogger().addHandler(handler)
        try:
            run_backtest({"config": {"etf_allocation": 100}})
        finally:
            logging.getLogger().removeHandler(handler)
        self.assertFalse(any(record.pathname.endswith("backtester.py") for record in records))


if __name__ == "__main__":
    unittest.main()
