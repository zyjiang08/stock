"""Behavioral acceptance of the web adapter and original strategy engine."""

import math
import logging
import unittest
from copy import deepcopy
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pandas as pd

from src.backtester import Backtester, DataHandler, Portfolio
from src.web_app import ROOT, app, compare_cash_allocations, compare_rebalance_frequencies, config_from_json, metrics, parse_csv, run_backtest


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

    def test_growth_target_does_not_reset_allocation(self):
        row = run_backtest({})["rows"][1]
        audit = row["rebalance"]
        self.assertEqual(audit["mode"], "growth_target")
        self.assertAlmostEqual(audit["total_before"], 115000)
        self.assertAlmostEqual(audit["execution_target"], 65400)
        self.assertAlmostEqual(audit["allocation_target"], 69000)
        self.assertAlmostEqual(audit["weight_after"], 65400 / 115000)
        self.assertAlmostEqual(audit["requested_trade"], -9600)
        self.assertAlmostEqual(audit["cash_change"], 9600)

    def test_reset_uses_total_assets_and_consumes_final_signal(self):
        rows = run_backtest({})["rows"]
        trigger, skip, reset = rows[9:12]
        self.assertEqual([(r["rebalance"]["ignore_before"], r["rebalance"]["ignore_after"]) for r in (trigger, skip, reset)], [(0, 2), (2, 1), (1, 0)])
        self.assertTrue(trigger["rebalance"]["drawdown_hit"])
        self.assertAlmostEqual(trigger["rebalance"]["history_high"], max(r["etf_value"] for r in rows[1:9]))
        for hold in (trigger, skip):
            self.assertIsNone(hold["rebalance"]["execution_target"])
            self.assertEqual(hold["rebalance"]["cash_change"], 0)
        audit = reset["rebalance"]
        self.assertEqual(audit["mode"], "allocation_reset")
        self.assertAlmostEqual(audit["execution_target"], 86213.40476570294)
        self.assertNotAlmostEqual(audit["execution_target"], reset["target"])
        self.assertAlmostEqual(audit["weight_after"], .6)
        self.assertTrue(audit["sell_signal_consumed"])
        self.assertFalse(audit["active_after"])

    def test_buy_during_drawdown_preserves_remaining_signals(self):
        result = run_backtest({"source": "upload", "csv": "Date,ETF_Price\n2023-12-31,100\n2024-03-31,50\n2024-06-30,45\n2024-09-30,60\n2024-12-31,70", "config": {"lookback_quarters": 1}})
        initial, trigger, buy, skip, reset = result["rows"]
        self.assertEqual([r["kind"] for r in result["rows"]], ["initial", "drawdown", "buy", "skip", "reset"])
        self.assertAlmostEqual(buy["trade_amount"], 5700)
        self.assertEqual((buy["rebalance"]["ignore_before"], buy["rebalance"]["ignore_after"]), (2, 2))
        self.assertFalse(buy["rebalance"]["sell_signal_consumed"])
        # A proportional reset can require buying, even after a sell signal.
        self.assertGreater(reset["trade_amount"], 0)
        self.assertAlmostEqual(reset["rebalance"]["execution_target"], 51100)
        self.assertAlmostEqual(reset["trade_amount"], 700 / 3)

    def test_cash_shortfall_and_hundred_up_buy_reset(self):
        rows = run_backtest({"source": "upload", "csv": "Date,ETF_Price\n2024-03-31,100\n2024-06-30,20\n2024-09-30,41"})["rows"]
        cash, reset = rows[1:]
        self.assertEqual(cash["kind"], "cash")
        self.assertAlmostEqual(cash["rebalance"]["requested_trade"], 53400)
        self.assertIsNone(cash["rebalance"]["execution_target"])
        self.assertAlmostEqual(cash["trade_shares"], 0)
        self.assertEqual(reset["action"], "100-Up Rule Triggered")
        self.assertAlmostEqual(reset["rebalance"]["execution_target"], 38760)
        self.assertAlmostEqual(reset["trade_amount"], 14160)
        self.assertAlmostEqual(reset["rebalance"]["weight_after"], .6)

    def test_audit_balances_and_custom_allocations(self):
        for allocation in (1, 40, 60, 100):
            for row in run_backtest({"config": {"etf_allocation": allocation}})["rows"]:
                b = row["rebalance"]
                self.assertAlmostEqual(b["total_before"], row["total_value"])
                self.assertAlmostEqual(b["cash_change"], -row["trade_amount"])
                self.assertAlmostEqual(b["weight_before"], row["etf_before"] / b["total_before"])
                if b["execution_target"] is not None:
                    self.assertAlmostEqual(b["execution_target"], row["etf_value"])
                    self.assertAlmostEqual(b["requested_trade"], row["trade_amount"])
                if row["kind"] == "reset":
                    self.assertAlmostEqual(b["weight_after"], allocation / 100)

    def test_cash_comparison_matches_separate_strategy_runs(self):
        comparison = compare_cash_allocations({})
        self.assertEqual([(s["cash_allocation"], s["etf_allocation"]) for s in comparison["strategies"]], [(40, 60), (50, 50), (60, 40)])
        for strategy in comparison["strategies"]:
            direct = run_backtest({"config": {"etf_allocation": strategy["etf_allocation"]}})
            self.assertEqual(strategy["metrics"], direct["strategy"])
            self.assertEqual(strategy["trade_count"], direct["trade_count"])
            self.assertEqual(comparison["period"], direct["period"])
            for expected, actual in zip(direct["rows"], strategy["series"]):
                for field in ("date", "etf_value", "cash_value", "total_value", "drawdown"):
                    self.assertEqual(expected[field], actual[field])
                self.assertAlmostEqual(actual["total_return"], actual["total_value"] / 100000 - 1)

    def test_cash_comparison_manual_return_and_peak_drawdown(self):
        result = compare_cash_allocations({"source": "upload", "csv": "Date,ETF_Price\n2023-12-31,100\n2024-03-31,125\n2024-06-30,90"})
        # At 125, accounts are 115000/112500/110000; rebalance only moves cash.
        # At 90, total assets are shares after the sale * 90 + unspent cash.
        for strategy, peak, final in zip(result["strategies"], (115000, 112500, 110000), (96688, 97240, 97792)):
            self.assertAlmostEqual(strategy["series"][1]["total_value"], peak)
            self.assertAlmostEqual(strategy["metrics"]["final_value"], final)
            self.assertAlmostEqual(strategy["metrics"]["total_return"], final / 100000 - 1)
            self.assertAlmostEqual(strategy["metrics"]["max_drawdown"], final / peak - 1)
            self.assertIsNone(strategy["metrics"]["cagr"])

    def test_cash_comparison_keeps_shared_inputs_and_does_not_mutate(self):
        payload = {"start_date": "2023-01-01", "end_date": "2024-09-30", "config": {"initial_capital": 123456, "target_growth": 8, "lookback_quarters": 2, "drawdown_threshold": 25, "ignore_sell_signals": 3, "extreme_gain": 50, "etf_allocation": 97}}
        original = deepcopy(payload)
        comparison = compare_cash_allocations(payload)
        self.assertEqual(payload, original)
        self.assertEqual(comparison, compare_cash_allocations({**payload, "config": {**payload["config"], "etf_allocation": 1}}))
        self.assertEqual(comparison["period"]["start"], "2023-03-31")
        self.assertEqual(comparison["period"]["end"], "2024-09-30")
        self.assertNotIn("etf_allocation", comparison["shared_config"])
        for strategy in comparison["strategies"]:
            expected = run_backtest({**payload, "config": {**payload["config"], "etf_allocation": strategy["etf_allocation"]}})
            self.assertEqual(strategy["metrics"], expected["strategy"])
            self.assertAlmostEqual(strategy["initial_cash"], 123456 * strategy["cash_allocation"] / 100)

    def test_comparison_includes_initial_capital_in_drawdown(self):
        result = compare_cash_allocations({"source": "upload", "csv": "Date,ETF_Price\n2024-01-01,100\n2024-03-31,80\n2024-06-30,75"})
        for strategy, final, drawdown in zip(result["strategies"], (85000, 87500, 90000), (-.15, -.125, -.10)):
            self.assertAlmostEqual(strategy["metrics"]["final_value"], final)
            self.assertAlmostEqual(strategy["metrics"]["max_drawdown"], drawdown)
            self.assertLess(strategy["series"][0]["drawdown"], 0)
            self.assertIsNone(strategy["metrics"]["cagr"])

    def test_comparison_api_and_atomic_backtest_response(self):
        standalone = self.client.post("/api/compare", json={})
        self.assertEqual(standalone.status_code, 200)
        self.assertEqual(standalone.headers["Cache-Control"], "no-store")
        together = self.client.post("/api/backtest", json={"include_cash_comparison": True}).json
        self.assertEqual(together["cash_comparison"], standalone.json)
        self.assertEqual(together["strategy"], standalone.json["strategies"][0]["metrics"])
        self.assertNotIn("cash_comparison", self.client.post("/api/backtest", json={}).json)
        self.assertEqual(self.client.post("/api/backtest", json={"include_cash_comparison": "true"}).status_code, 400)
        for payload in ([], {"config": None}, {"source": "upload", "csv": "bad"}, {"start_date": "2025-01-01"}):
            with self.subTest(payload=payload):
                self.assertEqual(self.client.post("/api/compare", json=payload).status_code, 400)

    def test_frequency_schedules_growth_and_lookback_windows(self):
        result = compare_rebalance_frequencies({})
        self.assertEqual(result["valuation_sampling"], "quarter_end")
        self.assertEqual([g["months"] for g in result["groups"]], [3, 6, 12])
        for group, target, lookback, checks in zip(result["groups"], (9, 18.81, 41.158161), (8, 4, 2), (24, 12, 6)):
            self.assertAlmostEqual(group["target_growth_pct"], target)
            self.assertEqual(group["lookback_periods"], lookback)
            self.assertEqual(group["effective_lookback_months"], 24)
            self.assertEqual(group["check_count"], checks)
            self.assertEqual(group["initial_record_date"], "2018-12-31")
            self.assertEqual(group["incomplete_periods"], [])
            self.assertTrue(all(int(day[5:7]) % group["months"] == 0 for day in group["check_dates"]))
            self.assertEqual([s["cash_allocation"] for s in group["strategies"]], [40, 50, 60])
            self.assertTrue(all(len(s["series"]) == 25 for s in group["strategies"]))

    def test_frequency_quarterly_parity_and_cache_do_not_change_results(self):
        payload = {"config": {"initial_capital": 123456, "target_growth": 8, "etf_allocation": 97, "lookback_quarters": 7}}
        original = deepcopy(payload)
        cash = compare_cash_allocations(payload)
        fresh = compare_rebalance_frequencies(payload)
        self.assertEqual(fresh, compare_rebalance_frequencies(payload, cash))
        self.assertEqual(payload, original)
        for expected, actual in zip(cash["strategies"], fresh["groups"][0]["strategies"]):
            for field in ("metrics", "series", "trade_count"):
                self.assertEqual(actual[field], expected[field])
        self.assertEqual([g["effective_lookback_months"] for g in fresh["groups"]], [21, 24, 24])

    def test_frequency_manual_returns_and_unscheduled_drawdown(self):
        payload = {"source": "upload", "csv": "Date,ETF_Price\n2019-12-31,100\n2020-03-31,150\n2020-06-30,100\n2020-09-30,50\n2020-12-31,100", "config": {"initial_capital": 100, "target_growth": 0, "lookback_quarters": 40, "extreme_gain": 1000}}
        groups = compare_rebalance_frequencies(payload)["groups"]
        # 60% ETF quarterly: NAV 100,130,110,80,140; four actual trades.
        quarter = groups[0]["strategies"][0]
        for row, nav in zip(quarter["series"], (100, 130, 110, 80, 140)):
            self.assertAlmostEqual(row["total_value"], nav)
        self.assertAlmostEqual(quarter["metrics"]["total_return"], .4)
        self.assertAlmostEqual(quarter["metrics"]["max_drawdown"], 80 / 130 - 1)
        self.assertEqual(quarter["trade_count"], 4)
        # Half/year-end prices are unchanged, but quarter-end losses still count.
        for group in groups[1:]:
            result = group["strategies"][0]
            for row, nav in zip(result["series"], (100, 130, 100, 70, 100)):
                self.assertAlmostEqual(row["total_value"], nav)
            self.assertEqual(result["trade_count"], 0)
            self.assertAlmostEqual(result["metrics"]["max_drawdown"], 70 / 130 - 1)
            self.assertAlmostEqual(result["metrics"]["total_return"], 0)

    def test_frequency_compounded_targets_and_no_early_trades(self):
        groups = compare_rebalance_frequencies({"source": "upload", "csv": "Date,ETF_Price\n2019-12-31,100\n2020-03-31,100\n2020-06-30,100\n2020-09-30,100\n2020-12-31,100", "config": {"initial_capital": 100}})["groups"]
        for group, trades in zip(groups, (4, 2, 1)):
            strategy = group["strategies"][0]
            self.assertEqual(strategy["trade_count"], trades)
            self.assertAlmostEqual(strategy["series"][-1]["etf_value"], 60 * 1.09 ** 4)
            self.assertAlmostEqual(strategy["series"][-1]["cash_value"], 100 - 60 * 1.09 ** 4)
            self.assertAlmostEqual(strategy["metrics"]["final_value"], 100)
        self.assertAlmostEqual(groups[1]["strategies"][0]["series"][1]["cash_value"], 40)
        self.assertAlmostEqual(groups[2]["strategies"][0]["series"][3]["cash_value"], 40)

    def test_frequency_extreme_gain_only_at_scheduled_check(self):
        result = compare_rebalance_frequencies({"source": "upload", "csv": "Date,ETF_Price\n2018-12-31,100\n2019-03-31,200\n2019-06-30,150\n2019-09-30,100\n2019-12-31,250", "config": {"initial_capital": 100, "lookback_quarters": 40}})
        annual = result["groups"][2]["strategies"][0]
        self.assertAlmostEqual(annual["series"][1]["etf_value"], 120)  # No March reset.
        self.assertAlmostEqual(annual["series"][1]["cash_value"], 40)
        self.assertAlmostEqual(annual["series"][-1]["etf_value"], 114)  # December 150% gain resets 190 to 60/40.
        self.assertAlmostEqual(annual["series"][-1]["cash_value"], 76)
        self.assertEqual(annual["trade_count"], 1)

    def test_frequency_annual_drawdown_uses_converted_lookback(self):
        annual = compare_rebalance_frequencies({"source": "upload", "csv": "Date,ETF_Price\n2018-12-31,100\n2019-12-31,100\n2020-12-31,50", "config": {"initial_capital": 100, "target_growth": 0}})["groups"][2]
        self.assertEqual(annual["lookback_periods"], 2)
        # Two prior annual records suffice to trigger 30 Down; the drop quarter holds.
        strategy = annual["strategies"][0]
        self.assertAlmostEqual(strategy["series"][-1]["etf_value"], 30)
        self.assertAlmostEqual(strategy["series"][-1]["cash_value"], 40)
        self.assertEqual(strategy["trade_count"], 0)

    def test_frequency_incomplete_and_short_windows_are_explicit(self):
        payload = {"source": "upload", "csv": "Date,ETF_Price\n2024-03-31,100\n2024-06-30,80"}
        result = compare_rebalance_frequencies(payload)
        annual = result["groups"][2]
        self.assertEqual(annual["check_count"], 0)
        self.assertEqual(annual["check_dates"], [])
        self.assertEqual(annual["incomplete_periods"], [{"observation": "2024-06-30", "calendar_end": "2024-12-31"}])
        for strategy in annual["strategies"]:
            self.assertIsNone(strategy["metrics"]["cagr"])
            self.assertEqual(strategy["trade_count"], 0)
        self.assertAlmostEqual(annual["strategies"][0]["metrics"]["max_drawdown"], -.12)
        partial = compare_rebalance_frequencies({"end_date": "2024-09-30"})["groups"][2]
        self.assertEqual(partial["check_dates"][-1], "2024-09-30")
        self.assertEqual(partial["incomplete_periods"][-1]["calendar_end"], "2024-12-31")

    def test_frequency_api_atomic_response_and_validation(self):
        response = self.client.post("/api/compare-frequency", json={})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["Cache-Control"], "no-store")
        together = self.client.post("/api/backtest", json={"include_cash_comparison": True, "include_frequency_comparison": True})
        self.assertEqual(together.status_code, 200)
        self.assertEqual(together.json["frequency_comparison"], response.json)
        for payload in ([], {"config": None}, {"source": "upload", "csv": "bad"}, {"start_date": "2025-01-01"}):
            self.assertEqual(self.client.post("/api/compare-frequency", json=payload).status_code, 400)
        self.assertEqual(self.client.post("/api/backtest", json={"include_frequency_comparison": "true"}).status_code, 400)

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
