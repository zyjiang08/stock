"""Browser interface to the original backtester; uploaded data stays in memory."""

import csv
import io
import logging
import math
import re
from datetime import date
from dataclasses import replace
from pathlib import Path

import pandas as pd
from flask import Flask, jsonify, request, send_file
from werkzeug.exceptions import BadRequest, RequestEntityTooLarge

from .backtester import Backtester, DataHandler, Portfolio, StrategyConfig

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web"
MAX_ROWS = 25000
DEFAULTS = {
    "initial_capital": 100000,
    "etf_allocation": 60,
    "target_growth": 9,
    "drawdown_threshold": 30,
    "lookback_quarters": 8,
    "ignore_sell_signals": 2,
    "extreme_gain": 100,
}
app = Flask(__name__, static_folder=str(WEB / "assets"), static_url_path="/assets")
app.config.update(MAX_CONTENT_LENGTH=2 * 1024 * 1024, JSON_SORT_KEYS=False)
app.json.ensure_ascii = False
# The original CLI logs portfolio amounts. Keep those request-specific values
# out of the shared web service's persistent logs, without changing CLI behavior.
logging.getLogger().addFilter(lambda record: record.pathname != str(ROOT / "src" / "backtester.py"))


def parse_date(value, label):
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        raise ValueError(f"{label}必须使用 YYYY-MM-DD 格式。")
    try:
        result = date.fromisoformat(value)
    except ValueError as exc:
        raise ValueError(f"{label}不是有效日期。") from exc
    if not 1900 <= result.year <= 2100:
        raise ValueError(f"{label}年份须在 1900–2100 之间。")
    return result


def parse_csv(text):
    if not isinstance(text, str) or not text.strip():
        raise ValueError("请先选择演示数据或上传 CSV 文件。")
    if len(text.encode("utf-8")) > app.config["MAX_CONTENT_LENGTH"]:
        raise ValueError("CSV 文件不能超过 2 MiB。")
    reader = csv.reader(io.StringIO(text.lstrip("\ufeff")), strict=True)
    try:
        header = [s.strip() for s in next(reader)]
    except (StopIteration, csv.Error) as exc:
        raise ValueError("CSV 表头无法读取。") from exc
    if len(set(header)) != len(header):
        raise ValueError("CSV 表头不能包含重复列名。")
    if "Date" not in header:
        raise ValueError("CSV 缺少 Date 列；日期格式应为 YYYY-MM-DD。")
    price_column = next((s for s in ("ETF_Price", "Adj Close", "Close", "Price") if s in header), None)
    if price_column is None:
        raise ValueError("CSV 缺少价格列，请使用 ETF_Price、Adj Close、Close 或 Price。")
    date_idx, price_idx = header.index("Date"), header.index(price_column)
    dates, prices, seen, warnings = [], [], set(), []
    try:
        for row in reader:
            if not row or all(not cell.strip() for cell in row):
                continue
            number = reader.line_num
            if len(row) != len(header):
                raise ValueError(f"第 {number} 行列数与表头不一致。")
            day = parse_date(row[date_idx].strip(), f"第 {number} 行日期")
            if day in seen:
                raise ValueError(f"第 {number} 行日期 {day} 重复，请先合并重复数据。")
            try:
                price = float(row[price_idx].strip())
            except ValueError as exc:
                raise ValueError(f"第 {number} 行价格不是数字。") from exc
            if not math.isfinite(price) or not 0.000001 <= price <= 1e9:
                raise ValueError(f"第 {number} 行价格须为 0.000001–1,000,000,000 的有限正数。")
            dates.append(day)
            prices.append(price)
            seen.add(day)
            if len(dates) > MAX_ROWS:
                raise ValueError(f"最多支持 {MAX_ROWS:,} 行价格数据。")
    except csv.Error as exc:
        raise ValueError("CSV 格式错误，请检查逗号与引号。") from exc
    if len(dates) < 2:
        raise ValueError("至少需要两条价格记录。")
    if dates != sorted(dates):
        warnings.append("CSV 原始日期未排序，已按日期从早到晚排列。")
    ignored = [s for s in header if s not in ("Date", price_column)]
    if ignored:
        warnings.append("已忽略其他列；本引擎仅使用日期与 ETF 价格，现金不计利息。")
    frame = pd.DataFrame({"ETF_Price": prices, "Cash_Rate": 0.0}, index=pd.to_datetime(dates)).sort_index()
    frame.index.name = "Date"
    return frame, warnings, price_column


def config_from_json(raw):
    if not isinstance(raw, dict):
        raise ValueError("参数必须是 JSON 对象。")
    unknown = set(raw) - set(DEFAULTS)
    if unknown:
        raise ValueError("包含无法识别的回测参数。")
    values = {**DEFAULTS, **raw}
    limits = {
        "initial_capital": (1, 1e9, "初始资金"),
        "etf_allocation": (1, 100, "ETF 初始占比"),
        "target_growth": (0, 100, "季度目标"),
        "drawdown_threshold": (1, 99, "回撤触发阈值"),
        "lookback_quarters": (1, 40, "回看季度数"),
        "ignore_sell_signals": (1, 10, "忽略卖出次数"),
        "extreme_gain": (1, 1000, "单季大涨阈值"),
    }
    for key, (low, high, label) in limits.items():
        value = values[key]
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
            raise ValueError(f"{label}必须是有限数字。")
        if not low <= value <= high:
            raise ValueError(f"{label}须在 {low:g}–{high:g} 之间。")
    for key in ("lookback_quarters", "ignore_sell_signals"):
        if values[key] != int(values[key]):
            raise ValueError("季度数与忽略卖出次数必须是整数。")
    allocation = values["etf_allocation"] / 100
    return StrategyConfig(
        initial_capital=values["initial_capital"], etf_allocation=allocation,
        cash_allocation=1 - allocation, target_quarterly_growth=values["target_growth"] / 100,
        drawdown_threshold=values["drawdown_threshold"] / 100,
        drawdown_lookback_quarters=int(values["lookback_quarters"]),
        sell_signals_to_ignore_on_drawdown=int(values["ignore_sell_signals"]),
        extreme_gain_threshold=values["extreme_gain"] / 100,
    ), values


def dataset(payload):
    source = payload.get("source", "demo")
    if source == "demo":
        text = (ROOT / "data" / "demo_prices.csv").read_text(encoding="utf-8")
        label = "规则演示 · 模拟价格（非历史行情）"
    elif source == "upload":
        text = payload.get("csv")
        label = "用户上传 CSV · 价格口径由上传者确认"
    else:
        raise ValueError("数据来源无效。")
    frame, warnings, price_column = parse_csv(text)
    return frame, warnings, {"id": source, "label": label, "price_column": price_column}


def metrics(values, capital, elapsed_days):
    peak, worst = capital, 0.0
    drawdowns = []
    for value in values:
        peak = max(peak, value)
        drawdown = value / peak - 1
        worst = min(worst, drawdown)
        drawdowns.append(drawdown)
    return {
        "final_value": values[-1], "total_return": values[-1] / capital - 1,
        "cagr": (values[-1] / capital) ** (365.25 / elapsed_days) - 1 if elapsed_days >= 365 else None,
        "max_drawdown": worst,
    }, drawdowns


def explain(action, is_first):
    if is_first:
        return "initial", "初始季度记录", "按首条价格建立初始持仓；原引擎的第一个季度只记录，不调仓。"
    if action == "30-Down Rule Triggered":
        return "drawdown", "30 Down 触发", "本季 ETF 调仓前市值跌至过去指定季度最高调仓后市值的阈值以下。原引擎本季不交易，后续开始忽略卖出。"
    if action == "100-Up Rule Triggered":
        return "reset", "100 Up 重置", "本季 ETF 市值增长达到大涨阈值，按初始 ETF / 现金比例重置，并清除回撤状态。"
    if action == "30-Down Complete & Rebalance":
        return "reset", "30 Down 结束并重置", "忽略卖出次数已用完，原引擎在本次信号当季按初始比例重置。"
    if action.startswith("Ignore Sell"):
        count = re.search(r"(\d+) left", action).group(1)
        return "skip", "忽略卖出信号", f"回撤状态中，本次不卖出；还需忽略 {count} 次卖出信号。"
    if action == "Insufficient Cash":
        return "cash", "现金不足 · 不交易", "现金不足以补足全部目标差额。原引擎跳过整笔买入，不会用剩余现金部分买入。"
    if action.startswith("Sell"):
        return "sell", "卖出 · 转入现金", "ETF 市值高于上季调仓后市值 ×（1 + 季度目标），卖出超出部分。"
    if action.startswith("Buy"):
        return "buy", "买入 · 补足目标", "ETF 市值低于或等于本季目标，现金足够时补足差额；差额为零时不产生实际交易。"
    return "hold", "持有", "本季保持持仓。"


def rebalance_details(row, history, config, active, remaining):
    """Explain the engine's recorded action; never decide or execute a trade here."""
    action, kind = row["action"], row["kind"]
    total = row["etf_before"] + row["cash_before"]
    lookback = config.drawdown_lookback_quarters
    high = max(r["etf_value"] for r in history[-lookback:]) if len(history) >= lookback else None
    level = high * (1 - config.drawdown_threshold) if high is not None else None
    growth = (row["etf_before"] - row["previous_etf"]) / row["previous_etf"] if row["previous_etf"] else None
    after_active, after_remaining = active, remaining
    if kind == "drawdown":
        after_active, after_remaining = True, config.sell_signals_to_ignore_on_drawdown
    elif kind == "reset":
        after_active, after_remaining = False, 0
    elif kind == "skip":
        after_remaining = int(re.search(r"(\d+) left", action).group(1))
    mode = "allocation_reset" if kind == "reset" else "growth_target" if kind in ("buy", "sell", "cash") else "initial" if kind == "initial" else "hold"
    planned = total * config.etf_allocation if mode == "allocation_reset" else row["target"] if mode == "growth_target" else None
    # A skipped signal has a reference growth target, but no execution target.
    executed = planned if kind in ("buy", "sell", "reset") else None
    return {
        "mode": mode,
        "mode_label": {"allocation_reset": "按初始比例再平衡", "growth_target": "按季度增长目标调仓", "initial": "首季记录", "hold": "本季保持持仓"}[mode],
        "total_before": total,
        "weight_before": row["etf_before"] / total,
        "weight_after": row["etf_value"] / row["total_value"],
        "allocation_target": total * config.etf_allocation,
        "planned_target": planned,
        "execution_target": executed,
        "requested_trade": planned - row["etf_before"] if planned is not None else None,
        "cash_change": row["cash_value"] - row["cash_before"],
        "quarter_growth": growth,
        "history_quarters": min(len(history), lookback),
        "history_high": high,
        "drawdown_level": level,
        "drawdown_hit": level is not None and row["etf_before"] <= level,
        "active_before": active, "active_after": after_active,
        "ignore_before": remaining, "ignore_after": after_remaining,
        "sell_signal_consumed": kind == "skip" or action == "30-Down Complete & Rebalance",
    }


def prepare_prices(payload):
    """Validate one shared price window before selecting decision dates."""
    frame, warnings, source = dataset(payload)
    start = parse_date(payload["start_date"], "开始日期") if payload.get("start_date") else frame.index[0].date()
    end = parse_date(payload["end_date"], "结束日期") if payload.get("end_date") else frame.index[-1].date()
    if start > end:
        raise ValueError("开始日期不能晚于结束日期。")
    frame = frame.loc[str(start):str(end)]
    if len(frame) < 2:
        raise ValueError("所选日期区间至少需要两条价格记录。")
    quarter_ends = DataHandler.get_quarter_end_dates(frame)
    if len(quarter_ends) < 2:
        raise ValueError("所选数据至少需要覆盖两个自然季度，首季度仅作初始记录。")
    if frame.index[-1].to_period("Q").end_time.normalize() - frame.index[-1] > pd.Timedelta(days=6):
        warnings.append("末条价格明显早于日历季末；原引擎仍将它视为该季度最后价格，可能包含未完成季度。")
    if source["id"] == "demo":
        warnings.insert(0, "当前使用人工构造的模拟价格，仅用于演示操作与规则，不是 TQQQ 的历史收益。")
    return frame, quarter_ends, warnings, source


def run_backtest(payload):
    config, parameters = config_from_json(payload.get("config", {}))
    frame, quarter_ends, warnings, source = prepare_prices(payload)
    backtester = Backtester(config, Portfolio(config), DataHandler())
    result = backtester.run(frame, quarter_ends)
    initial_price = float(frame.iloc[0]["ETF_Price"])
    previous_shares = config.initial_capital * config.etf_allocation / initial_price
    previous_cash = config.initial_capital * config.cash_allocation
    previous_etf = None
    active, remaining = False, 0
    rows = []
    for i, record in result.iterrows():
        price, shares = float(record["etf_price"]), float(record["etf_shares"])
        kind, label, description = explain(record["action"], i == 0)
        day = record["date"]
        row = {
            "date": day.strftime("%Y-%m-%d"), "quarter": f"{day.year} Q{day.quarter}",
            "etf_price": price, "shares_before": previous_shares,
            "etf_before": previous_shares * price, "cash_before": previous_cash,
            "previous_etf": previous_etf,
            "target": previous_etf * (1 + config.target_quarterly_growth) if previous_etf is not None else None,
            "etf_shares": shares, "etf_value": float(record["etf_value"]),
            "cash_value": float(record["cash_value"]), "total_value": float(record["total_value"]),
            "benchmark_value": config.initial_capital * price / initial_price,
            "trade_shares": shares - previous_shares, "trade_amount": (shares - previous_shares) * price,
            "action": record["action"], "kind": kind, "label": label, "explanation": description,
        }
        if not all(math.isfinite(v) for v in row.values() if isinstance(v, (int, float))):
            raise ValueError("数据或参数导致结果溢出，请缩短区间或减小参数。")
        row["rebalance"] = rebalance_details(row, rows, config, active, remaining)
        if not all(math.isfinite(v) for v in row["rebalance"].values() if isinstance(v, (int, float))):
            raise ValueError("数据或参数导致调仓过程溢出，请缩短区间或减小参数。")
        active, remaining = row["rebalance"]["active_after"], row["rebalance"]["ignore_after"]
        rows.append(row)
        previous_shares, previous_cash, previous_etf = shares, row["cash_value"], row["etf_value"]
    elapsed = (frame.index[-1] - frame.index[0]).days
    strategy, drawdowns = metrics([r["total_value"] for r in rows], config.initial_capital, elapsed)
    benchmark, benchmark_drawdowns = metrics([r["benchmark_value"] for r in rows], config.initial_capital, elapsed)
    for row, dd, bdd in zip(rows, drawdowns, benchmark_drawdowns):
        row.update(drawdown=dd, benchmark_drawdown=bdd)
    return {
        "source": source, "config": parameters, "warnings": warnings, "rows": rows,
        "strategy": strategy, "benchmark": benchmark,
        "period": {"start": frame.index[0].strftime("%Y-%m-%d"), "end": frame.index[-1].strftime("%Y-%m-%d"), "days": elapsed, "observations": len(frame), "quarters": len(rows)},
        "trade_count": sum(abs(r["trade_shares"]) > 1e-8 for r in rows),
    }


def body():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        raise ValueError("请提交有效的 JSON 对象。")
    return payload


def compare_cash_allocations(payload, current=None):
    """Run the same engine at 40/50/60% initial and reset cash allocations."""
    _, parameters = config_from_json(payload.get("config", {}))
    strategies = []
    reference = None
    for cash in (40, 50, 60):
        config = {**parameters, "etf_allocation": 100 - cash}
        result = current if current is not None and current["config"] == config else run_backtest({**payload, "config": config})
        if reference is None:
            reference = result
        capital = config["initial_capital"]
        strategies.append({
            "cash_allocation": cash, "etf_allocation": 100 - cash,
            "initial_cash": capital * cash / 100, "initial_etf": capital * (100 - cash) / 100,
            "metrics": dict(result["strategy"]), "trade_count": result["trade_count"],
            "series": [{
                "date": row["date"], "quarter": row["quarter"],
                "total_value": row["total_value"], "total_return": row["total_value"] / capital - 1,
                "drawdown": row["drawdown"], "etf_value": row["etf_value"], "cash_value": row["cash_value"],
            } for row in result["rows"]],
        })
    return {
        "source": reference["source"], "period": reference["period"], "warnings": reference["warnings"],
        "shared_config": {key: value for key, value in parameters.items() if key != "etf_allocation"},
        "strategies": strategies,
    }


def compare_rebalance_frequencies(payload, quarterly=None):
    """Compare 3/6/12-month signal checks on a common quarterly valuation grid.

    The unchanged engine receives period end dates, a compounded growth target,
    and a lookback rounded up to whole decision periods. The extreme-gain
    threshold remains the configured percentage, measured per decision period.
    As in the original adapter, the last observation represents each period end.
    """
    config, parameters = config_from_json(payload.get("config", {}))
    frame, quarter_ends, warnings, source = prepare_prices(payload)
    capital = config.initial_capital
    elapsed = (frame.index[-1] - frame.index[0]).days
    first_price = float(frame.iloc[0]["ETF_Price"])
    groups = []
    for months, label in ((3, "每 3 个月"), (6, "每半年"), (12, "每一年")):
        period_ends = pd.DatetimeIndex(frame.groupby([frame.index.year, (frame.index.month - 1) // months]).apply(lambda rows: rows.index.max()).values)
        growth = config.target_quarterly_growth if months == 3 else (1 + config.target_quarterly_growth) ** (months // 3) - 1
        lookback = math.ceil(config.drawdown_lookback_quarters * 3 / months)
        incomplete = []
        for day in period_ends:
            last_month = ((day.month - 1) // months + 1) * months
            calendar_end = pd.Timestamp(year=day.year, month=last_month, day=1) + pd.offsets.MonthEnd(0)
            if calendar_end - day > pd.Timedelta(days=6):
                incomplete.append({"observation": day.strftime("%Y-%m-%d"), "calendar_end": calendar_end.strftime("%Y-%m-%d")})
        strategies = []
        for cash in (40, 50, 60):
            allocation = (100 - cash) / 100
            period_config = replace(config, etf_allocation=allocation, cash_allocation=1 - allocation,
                                    target_quarterly_growth=growth, drawdown_lookback_quarters=lookback)
            if months == 3 and quarterly is not None:
                cached = next(s for s in quarterly["strategies"] if s["cash_allocation"] == cash)
                strategies.append({"cash_allocation": cash, "etf_allocation": 100 - cash,
                                   "metrics": dict(cached["metrics"]), "trade_count": cached["trade_count"],
                                   "series": [dict(point) for point in cached["series"]]})
                continue
            records = Backtester(period_config, Portfolio(period_config), DataHandler()).run(frame, period_ends).to_dict("records")
            decisions = {record["date"]: record for record in records}
            held_shares, held_cash = capital * allocation / first_price, capital * (1 - allocation)
            previous_shares, trade_count = held_shares, 0
            for record in records:
                trade_count += abs(float(record["etf_shares"]) - previous_shares) > 1e-8
                previous_shares = float(record["etf_shares"])
            series = []
            for day in quarter_ends:
                if day in decisions:
                    held_shares = float(decisions[day]["etf_shares"])
                    held_cash = float(decisions[day]["cash_value"])
                etf_value = held_shares * float(frame.loc[day, "ETF_Price"])
                total = etf_value + held_cash
                if not all(math.isfinite(v) for v in (etf_value, held_cash, total)):
                    raise ValueError("周期模拟结果溢出，请缩短区间或减小参数。")
                series.append({"date": day.strftime("%Y-%m-%d"), "quarter": f"{day.year} Q{day.quarter}",
                               "total_value": total, "total_return": total / capital - 1,
                               "etf_value": etf_value, "cash_value": held_cash})
            summary, drawdowns = metrics([p["total_value"] for p in series], capital, elapsed)
            if not all(math.isfinite(v) for v in summary.values() if v is not None):
                raise ValueError("周期模拟指标溢出，请缩短区间或减小参数。")
            for point, drawdown in zip(series, drawdowns):
                point["drawdown"] = drawdown
            strategies.append({"cash_allocation": cash, "etf_allocation": 100 - cash,
                               "metrics": summary, "trade_count": int(trade_count), "series": series})
        groups.append({"months": months, "label": label, "target_growth_pct": growth * 100,
                       "lookback_periods": lookback, "effective_lookback_months": lookback * months,
                       "extreme_gain_pct": parameters["extreme_gain"],
                       "initial_record_date": period_ends[0].strftime("%Y-%m-%d"),
                       "check_dates": [d.strftime("%Y-%m-%d") for d in period_ends[1:]],
                       "check_count": len(period_ends) - 1, "incomplete_periods": incomplete,
                       "strategies": strategies})
    return {
        "source": source, "warnings": warnings,
        "period": {"start": frame.index[0].strftime("%Y-%m-%d"), "end": frame.index[-1].strftime("%Y-%m-%d"),
                   "days": elapsed, "observations": len(frame), "quarters": len(quarter_ends)},
        "shared_config": {key: value for key, value in parameters.items() if key != "etf_allocation"},
        "valuation_sampling": "quarter_end", "schedule": "calendar_period_last_observation", "groups": groups,
    }


@app.after_request
def headers(response):
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "same-origin"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
    if request.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    return response


@app.errorhandler(ValueError)
@app.errorhandler(BadRequest)
def invalid(exc):
    return jsonify(error=str(exc)), 400


@app.errorhandler(RequestEntityTooLarge)
def too_large(_exc):
    return jsonify(error="文件或请求超过 2 MiB，请缩小 CSV 后重试。"), 413


@app.get("/")
def index():
    return send_file(WEB / "index.html")


@app.get("/guide")
def guide():
    return send_file(WEB / "guide.html")


@app.get("/healthz")
def health():
    return jsonify(status="ok", service="9sig-backtest", engine="original-python")


@app.get("/api/sample.csv")
def sample():
    return send_file(ROOT / "data" / "demo_prices.csv", mimetype="text/csv; charset=utf-8", as_attachment=True, download_name="9sig-demo-synthetic-prices.csv")


@app.post("/api/preview")
def preview():
    frame, warnings, source = dataset(body())
    return jsonify(source=source, warnings=warnings, observations=len(frame), quarters=len(DataHandler.get_quarter_end_dates(frame)), start=frame.index[0].strftime("%Y-%m-%d"), end=frame.index[-1].strftime("%Y-%m-%d"), first_price=float(frame.iloc[0]["ETF_Price"]), last_price=float(frame.iloc[-1]["ETF_Price"]))


@app.post("/api/backtest")
def backtest():
    payload = body()
    include_comparison = payload.get("include_cash_comparison", False)
    include_frequencies = payload.get("include_frequency_comparison", False)
    if not isinstance(include_comparison, bool):
        raise ValueError("现金对比开关必须是布尔值。")
    if not isinstance(include_frequencies, bool):
        raise ValueError("周期对比开关必须是布尔值。")
    result = run_backtest(payload)
    if include_comparison:
        result["cash_comparison"] = compare_cash_allocations(payload, result)
    if include_frequencies:
        result["frequency_comparison"] = compare_rebalance_frequencies(payload, result.get("cash_comparison"))
    return jsonify(result)


@app.post("/api/compare")
def compare():
    return jsonify(compare_cash_allocations(body()))


@app.post("/api/compare-frequency")
def compare_frequency():
    return jsonify(compare_rebalance_frequencies(body()))
