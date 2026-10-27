"use strict";
const $ = (id) => document.getElementById(id);
const money = (value, digits = 0) => Number.isFinite(value) ? new Intl.NumberFormat("en-US", {style: "currency", currency: "USD", maximumFractionDigits: digits, minimumFractionDigits: digits}).format(value) : "—";
const percent = (value) => Number.isFinite(value) ? `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%` : "区间不足一年";
const shares = (value) => Number.isFinite(value) ? `${value > 1e-8 ? "+" : ""}${Math.abs(value) < 1e-8 ? "0" : value.toFixed(4)}` : "—";
const state = {source: "demo", csv: null, ready: false, result: null, selected: 1, chart: "value", revision: 0, busy: false, tour: -1, rebalanceStep: 0, comparisonChart: "total_return", comparisonIndex: 0};
const comparisonColors = ["#176d60", "#526eb2", "#ad7133"];
const weight = (value) => `${(value * 100).toFixed(2)}%`;
const quantity = (value) => value.toLocaleString("en-US", {minimumFractionDigits: 4, maximumFractionDigits: 4});
const parameterFields = {initial_capital: "initial-capital", etf_allocation: "allocation", target_growth: "target-growth", drawdown_threshold: "drawdown-threshold", lookback_quarters: "lookback", ignore_sell_signals: "ignore-signals", extreme_gain: "extreme-gain"};
const defaults = {initial_capital: 100000, etf_allocation: 60, target_growth: 9, drawdown_threshold: 30, lookback_quarters: 8, ignore_sell_signals: 2, extreme_gain: 100};

async function api(path, payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 40000);
  try {
    const response = await fetch(path, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(payload), signal: controller.signal});
    let data;
    try { data = await response.json(); } catch { throw new Error("服务器返回格式异常，请稍后重试。"); }
    if (!response.ok) throw new Error(data.error || `请求失败（${response.status}）。`);
    return data;
  } catch (error) {
    if (error.name === "AbortError") throw new Error("请求超过 40 秒，请检查服务后重试。");
    if (error instanceof TypeError) throw new Error("无法连接回测服务，请检查网络连接后重试。");
    throw error;
  } finally { clearTimeout(timer); }
}
function showError(message) {
  $("error").textContent = message;
  $("error").hidden = !message;
  if (message) $("error").scrollIntoView({behavior: "smooth", block: "center"});
}
function allocationLabels() {
  const amount = Number($("initial-capital").value), allocation = Number($("allocation").value);
  $("allocation-value").textContent = allocation;
  $("etf-money").textContent = money(amount * allocation / 100);
  $("cash-money").textContent = money(amount * (1 - allocation / 100));
}
function dirty() {
  state.revision++;
  $("stale-note").hidden = !state.result;
  $("export").disabled = true;
  $("comparison-export").disabled = true;
  $("comparison-stale").hidden = !state.result;
  if (state.result) $("result-status").textContent = "设置已更改 · 等待重新运行";
}
function sourcePayload() { return {source: state.source, ...(state.source === "upload" ? {csv: state.csv} : {})}; }
function setBusy(busy) {
  state.busy = busy;
  $("run").disabled = busy || !state.ready;
  $("run").textContent = busy ? "正在运行…" : "运行回测 →";
  $("results").setAttribute("aria-busy", String(busy));
}
async function loadSource(source, text = null, filename = "") {
  dirty();
  const revision = state.revision;
  state.source = source; state.csv = text; state.ready = false;
  $("run").disabled = true;
  $("data-label").textContent = "正在校验数据…"; $("data-range").textContent = "";
  showError("");
  try {
    const preview = await api("/api/preview", sourcePayload());
    if (revision !== state.revision) return false;
    if (preview.quarters < 2) throw new Error("数据至少须覆盖两个自然季度。首季度仅作初始记录。");
    $("data-label").textContent = source === "demo" ? `${preview.observations} 条模拟价格 · ${preview.quarters} 个季度` : filename;
    $("data-range").textContent = `${preview.start} — ${preview.end}${source === "upload" ? ` · ${preview.observations} 条` : ""}`;
    $("start-date").value = preview.start; $("end-date").value = preview.end;
    for (const id of ["start-date", "end-date"]) { $(id).min = preview.start; $(id).max = preview.end; }
    state.ready = true;
    $("run").disabled = state.busy;
    return true;
  } catch (error) {
    if (revision !== state.revision) return false;
    $("data-label").textContent = "数据尚未通过校验";
    showError(error.message);
    return false;
  }
}
async function runBacktest() {
  if (!state.ready || state.busy || !$("settings").reportValidity()) return false;
  const config = Object.fromEntries(Object.entries(parameterFields).map(([key, id]) => [key, Number($(id).value)]));
  const payload = {...sourcePayload(), config, start_date: $("start-date").value, end_date: $("end-date").value, include_cash_comparison: true};
  const revision = state.revision;
  setBusy(true); showError(""); $("export").disabled = true;
  $("comparison-export").disabled = true; $("comparison-stale").hidden = !state.result;
  $("result-status").textContent = "正在计算季度信号…";
  try {
    const result = await api("/api/backtest", payload);
    if (revision !== state.revision) return false;
    state.result = result; state.selected = Math.min(1, result.rows.length - 1);
    renderResult();
    $("stale-note").hidden = true;
    $("export").disabled = false;
    $("comparison-export").disabled = false;
    $("comparison-stale").hidden = true;
    $("result-status").textContent = result.source.id === "demo" ? "演示回测已完成 · 模拟价格" : "CSV 回测已完成";
    return true;
  } catch (error) {
    if (revision === state.revision) {
      showError(error.message);
      $("result-status").textContent = "运行失败 · 请检查输入后重试";
      $("stale-note").hidden = !state.result;
    }
    return false;
  } finally { setBusy(false); }
}
function renderResult() {
  const r = state.result;
  $("final-value").textContent = money(r.strategy.final_value);
  $("total-return").textContent = `累计收益 ${percent(r.strategy.total_return)}`;
  $("benchmark-value").textContent = money(r.benchmark.final_value);
  $("benchmark-return").textContent = `累计收益 ${percent(r.benchmark.total_return)}`;
  $("max-drawdown").textContent = percent(r.strategy.max_drawdown);
  $("trade-count").textContent = r.trade_count;
  $("quarter-count").textContent = `共 ${r.period.quarters} 个季度 · 首季仅记录`;
  $("period-label").textContent = `${r.period.start} — ${r.period.end}`;
  $("chart-subtitle").textContent = `${r.config.etf_allocation}% ETF / ${100 - r.config.etf_allocation}% 现金 · 季度目标 ${r.config.target_growth}% · USD`;
  $("strategy-growth").textContent = `${1 + r.config.target_growth / 100}`;
  $("strategy-allocation").textContent = `${r.config.etf_allocation}%`;
  $("quarter-slider").max = r.rows.length - 1;
  renderCashComparison();
  renderTable(); renderNotes(); renderScenarios(); selectQuarter(state.selected); drawChart();
}
function renderCashComparison() {
  const comparison = state.result.cash_comparison, c = comparison.shared_config;
  $("comparison-context").textContent = `${comparison.source.id === "demo" ? "模拟数据演示 · 非真实历史收益" : "用户上传 CSV"} · ${comparison.period.start} — ${comparison.period.end} · 同额本金 ${money(c.initial_capital)} · ${comparison.period.quarters} 个季度`;
  $("comparison-rules").textContent = `统一规则：季度目标 ${c.target_growth}%；回撤阈值 ${c.drawdown_threshold}%；回看 ${c.lookback_quarters} 季；忽略 ${c.ignore_sell_signals} 次卖出；单季大涨 ${c.extreme_gain}% 重置。现金无利息，不计税费与滑点。`;
  const container = $("comparison-cards"); container.replaceChildren();
  comparison.strategies.forEach((strategy, index) => {
    const card = document.createElement("article"); card.className = "comparison-card"; card.dataset.cash = strategy.cash_allocation;
    card.style.setProperty("--comparison-color", comparisonColors[index]);
    const title = document.createElement("h3"); title.textContent = `${strategy.cash_allocation}% 现金`;
    const subtitle = document.createElement("p"); subtitle.className = "hint"; subtitle.textContent = `${strategy.etf_allocation}% ETF · 初始现金 ${money(strategy.initial_cash)}`;
    const label = document.createElement("span"); label.className = "comparison-return-label"; label.textContent = "累计收益";
    const value = document.createElement("strong"); value.className = "comparison-total-return"; value.textContent = percent(strategy.metrics.total_return);
    const dl = document.createElement("dl");
    for (const [key, text, value] of [
      ["max_drawdown", "季度最大回撤", percent(strategy.metrics.max_drawdown)],
      ["cagr", "年化收益", percent(strategy.metrics.cagr)],
      ["final_value", "期末总资产", money(strategy.metrics.final_value, 2)],
      ["trade_count", "实际调仓", `${strategy.trade_count} 次`],
    ]) {
      const dt = document.createElement("dt"), dd = document.createElement("dd"); dt.textContent = text; dd.textContent = value; dd.dataset.metric = key; dl.append(dt, dd);
    }
    card.append(title, subtitle, label, value, dl); container.append(card);
  });
  $("comparison-slider").max = comparison.strategies[0].series.length - 1;
  selectComparisonQuarter(comparison.strategies[0].series.length - 1);
}
function selectComparisonQuarter(index) {
  const comparison = state.result?.cash_comparison;
  if (!comparison) return;
  state.comparisonIndex = Math.max(0, Math.min(Number(index), comparison.strategies[0].series.length - 1));
  $("comparison-slider").value = state.comparisonIndex;
  $("comparison-quarter").textContent = comparison.strategies[0].series[state.comparisonIndex].quarter;
  $("comparison-readout").replaceChildren();
  for (const strategy of comparison.strategies) {
    const point = strategy.series[state.comparisonIndex], item = document.createElement("p");
    item.textContent = `${strategy.cash_allocation}% 现金 · ${state.comparisonChart === "drawdown" ? "回撤" : "收益"} ${percent(point[state.comparisonChart])} · 总资产 ${money(point.total_value, 2)}`;
    $("comparison-readout").append(item);
  }
  drawComparisonChart();
}
function drawComparisonChart() {
  const comparison = state.result.cash_comparison, svg = $("comparison-chart"), field = state.comparisonChart;
  const addInitial = comparison.strategies[0].series[0].date !== comparison.period.start;
  const lines = comparison.strategies.map((strategy) => {
    const series = strategy.series.map((row, i) => ({date: row.date, value: row[field], index: i}));
    if (addInitial) series.unshift({date: comparison.period.start, value: 0, index: -1});
    return series;
  });
  const values = lines.flatMap((line) => line.map((point) => point.value));
  let low = Math.min(0, ...values), high = Math.max(0, ...values);
  if (high === low) { low -= .01; high += .01; }
  const padding = (high - low) * .08; low -= padding; high += padding;
  const left = 68, top = 20, width = 810, height = 254;
  const x = (i) => left + i / (lines[0].length - 1) * width;
  const y = (v) => top + (high - v) / (high - low) * height;
  svg.replaceChildren();
  svg.setAttribute("aria-label", `40%、50%、60% 现金策略的${field === "drawdown" ? "回撤" : "累计收益"}对比，点击图表或使用下方滑块逐季查看`);
  for (let i = 0; i <= 4; i++) {
    const value = low + (high - low) * i / 4;
    svg.append(svgElement("line", {x1: left, x2: left + width, y1: y(value), y2: y(value), stroke: "#e5ece8", "stroke-dasharray": "3 4"}));
    svg.append(svgElement("text", {x: left - 10, y: y(value) + 4, "text-anchor": "end", fill: "#84928a", "font-size": 11}, `${(value * 100).toFixed(1)}%`));
  }
  const labels = [...new Set(Array.from({length: Math.min(5, lines[0].length)}, (_, i) => Math.round(i * (lines[0].length - 1) / Math.min(4, lines[0].length - 1))))];
  for (const i of labels) svg.append(svgElement("text", {x: x(i), y: 306, "text-anchor": i === 0 ? "start" : i === lines[0].length - 1 ? "end" : "middle", fill: "#84928a", "font-size": 11}, lines[0][i].date.slice(0, 7)));
  const selected = state.comparisonIndex + (addInitial ? 1 : 0);
  svg.append(svgElement("line", {x1: x(selected), x2: x(selected), y1: top, y2: top + height, stroke: "#c1cec5", "stroke-dasharray": "3 4"}));
  lines.forEach((line, index) => {
    svg.append(svgElement("path", {d: line.map((p, i) => `${i ? "L" : "M"}${x(i)},${y(p.value)}`).join(" "), fill: "none", stroke: comparisonColors[index], "stroke-width": 2.5, "stroke-dasharray": ["none", "7 4", "2 4"][index], "stroke-linejoin": "round"}));
    svg.append(svgElement("circle", {cx: x(selected), cy: y(line[selected].value), r: 4, fill: comparisonColors[index], stroke: "white", "stroke-width": 1.5}));
  });
  svg.onclick = (event) => {
    const rect = svg.getBoundingClientRect();
    const i = Math.round(((event.clientX - rect.left) / rect.width * 900 - left) / width * (lines[0].length - 1));
    selectComparisonQuarter(i - (addInitial ? 1 : 0));
  };
}
function exportCashComparison() {
  if (!state.result || $("comparison-export").disabled) return;
  const comparison = state.result.cash_comparison;
  const rows = comparison.strategies.map((strategy) => ({
    source: comparison.source.id, start_date: comparison.period.start, end_date: comparison.period.end,
    cash_allocation_pct: strategy.cash_allocation, etf_allocation_pct: strategy.etf_allocation,
    ...comparison.shared_config, ...strategy.metrics, trade_count: strategy.trade_count,
    max_drawdown_sampling: "initial capital and quarter-end total assets",
  }));
  const fields = Object.keys(rows[0]), quote = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const csv = "\ufeff" + [fields.join(","), ...rows.map((row) => fields.map((field) => quote(row[field])).join(","))].join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], {type: "text/csv;charset=utf-8"}));
  const link = document.createElement("a"); link.href = url;
  link.download = `9sig-cash-comparison-${comparison.source.id === "demo" ? "DEMO-" : ""}${comparison.period.start}-${comparison.period.end}.csv`;
  link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function renderNotes() {
  const r = state.result, box = $("result-notes");
  box.replaceChildren();
  for (const text of [...r.warnings, `按实际经过天数计算年化收益：策略 ${percent(r.strategy.cagr)}，全仓持有 ${percent(r.benchmark.cagr)}。季度最大回撤仅覆盖采样点；对照组为 100% ETF，风险敞口不同。`]) {
    const p = document.createElement("p"); p.textContent = text; box.append(p);
  }
}
function renderTable() {
  $("quarter-table").replaceChildren();
  state.result.rows.forEach((row, index) => {
    const tr = document.createElement("tr"); tr.dataset.index = index;
    const td = document.createElement("td"), button = document.createElement("button"), small = document.createElement("small");
    button.type = "button"; button.textContent = row.quarter; button.setAttribute("aria-label", `查看 ${row.quarter} 的交易解释`);
    small.textContent = row.date; button.append(small); button.addEventListener("click", () => { selectQuarter(index); $("quarter-panel").scrollIntoView({behavior: "smooth", block: "center"}); });
    td.append(button); tr.append(td);
    for (const value of [money(row.etf_price, 2), money(row.total_value, 2), money(row.cash_value, 2), shares(row.trade_shares)]) {
      const cell = document.createElement("td"); cell.textContent = value; tr.append(cell);
    }
    const action = document.createElement("td"), badge = document.createElement("span");
    badge.className = `action-badge ${row.kind}`; badge.textContent = row.label; action.append(badge); tr.append(action);
    $("quarter-table").append(tr);
  });
}
function selectQuarter(index) {
  if (!state.result) return;
  state.selected = Math.max(0, Math.min(Number(index), state.result.rows.length - 1));
  const row = state.result.rows[state.selected];
  $("quarter-slider").value = state.selected;
  $("selected-quarter").textContent = row.quarter;
  $("detail-title").textContent = `${row.quarter} · ${row.date}`;
  $("action-badge").textContent = row.label; $("action-badge").className = `action-badge ${row.kind}`;
  $("detail-explanation").textContent = row.explanation;
  $("detail-before").textContent = money(row.etf_before, 2);
  $("detail-target").textContent = row.rebalance.execution_target === null ? "不调仓" : money(row.rebalance.execution_target, 2);
  $("detail-trade").textContent = shares(row.trade_shares);
  $("detail-cash").textContent = money(row.cash_value, 2);
  let formula = row.previous_etf === null ? `初始 ${money(state.result.config.initial_capital)} × ${state.result.config.etf_allocation}% ÷ 首条价格，建立 ETF 持仓。` : `普通季度参考目标 = 上季 ETF ${money(row.previous_etf, 2)} × ${1 + state.result.config.target_growth / 100} = ${money(row.target, 2)}。`;
  if (row.kind === "reset") formula += ` 本季执行比例重置：总资产 ${money(row.rebalance.total_before, 2)} × ${state.result.config.etf_allocation}% = ${money(row.rebalance.execution_target, 2)}。`;
  else if (["drawdown", "skip", "cash"].includes(row.kind)) formula += " 本季未执行该参考目标，持仓与现金保持不变。";
  $("detail-formula").textContent = formula;
  document.querySelectorAll("#quarter-table tr").forEach((tr) => tr.classList.toggle("selected", Number(tr.dataset.index) === state.selected));
  state.rebalanceStep = 0;
  renderRebalance();
  drawChart();
}
function renderScenarios() {
  const cases = [
    ["常规卖出", (r) => r.kind === "sell"], ["常规买入", (r) => r.kind === "buy" && r.trade_amount > 1e-8],
    ["30 Down 触发", (r) => r.kind === "drawdown"], ["忽略卖出", (r) => r.kind === "skip"],
    ["30 Down 再平衡", (r) => r.action === "30-Down Complete & Rebalance"],
    ["100 Up 再平衡", (r) => r.action === "100-Up Rule Triggered"], ["现金不足", (r) => r.kind === "cash"],
  ];
  $("rebalance-scenarios").replaceChildren();
  for (const [label, match] of cases) {
    const index = state.result.rows.findIndex(match), button = document.createElement("button");
    button.type = "button"; button.dataset.index = index; button.disabled = index < 0;
    button.textContent = label; button.title = index < 0 ? "当前结果没有此类季度" : `查看 ${state.result.rows[index].quarter}`;
    button.addEventListener("click", () => selectQuarter(index));
    $("rebalance-scenarios").append(button);
  }
}
function decisionEvidence(row) {
  const b = row.rebalance, c = state.result.config;
  if (row.kind === "initial") return "首条价格建立持仓后，第一个季度只记录；从第二个季度开始检查交易规则。";
  const history = b.history_high === null ? `回看期只有 ${b.history_quarters}/${c.lookback_quarters} 季，尚不检查 30 Down。` : `过去 ${c.lookback_quarters} 季调仓后 ETF 市值最高 ${money(b.history_high, 2)} × ${100 - c.drawdown_threshold}% = 触发线 ${money(b.drawdown_level, 2)}；本季调仓前 ${money(row.etf_before, 2)} ${b.drawdown_hit ? "≤" : ">"} 触发线。`;
  if (row.kind === "drawdown") return `${history} 期初未处于回撤状态，因此先触发 30 Down，本季不再执行后面的交易规则。`;
  const gain = `本季 ETF 市值变化 ${percent(b.quarter_growth)}，${b.quarter_growth >= c.extreme_gain / 100 ? "达到" : "未达到"} ${c.extreme_gain}% 的 100 Up 阈值。`;
  if (row.action === "100-Up Rule Triggered") return `${history} ${b.active_before ? "回撤状态已开启，不重复触发。" : "本季没有新触发的 30 Down。"}${gain} 本季先执行 100 Up，清空忽略计数。`;
  if (b.sell_signal_consumed) return `${gain} 调仓前 ETF ${money(row.etf_before, 2)} > 普通目标 ${money(row.target, 2)}，形成卖出信号。回撤状态中，剩余忽略次数 ${b.ignore_before} → ${b.ignore_after}${b.ignore_after === 0 ? "，当季立即按初始比例再平衡。" : "，本季持有。"}`;
  return `${history} ${b.active_before ? "回撤状态已开启，不重复触发；本季没有消耗忽略卖出的次数。" : ""}${gain} 进入普通季度目标判断。`;
}
function renderRebalance() {
  if (!state.result) return;
  const row = state.result.rows[state.selected], b = row.rebalance, c = state.result.config;
  const traded = Math.abs(row.trade_shares) > 1e-8, buy = row.trade_amount > 0;
  $("rebalance-mode").textContent = `${row.quarter} · ${b.mode_label}`;
  $("quarter-prev").disabled = state.selected === 0;
  $("quarter-next").disabled = state.selected === state.result.rows.length - 1;
  for (const button of $("rebalance-scenarios").children) button.setAttribute("aria-pressed", String(Number(button.dataset.index) === state.selected));
  let targetText, targetFormula;
  if (b.mode === "allocation_reset") {
    targetText = `以本季调仓前总资产为基数，ETF 恢复到 ${c.etf_allocation}%，现金恢复到 ${100 - c.etf_allocation}%。`;
    targetFormula = `ETF 目标 = ${money(b.total_before, 2)} × ${c.etf_allocation}% = ${money(b.planned_target, 2)}；现金目标 = ${money(b.total_before - b.planned_target, 2)}。`;
  } else if (b.mode === "growth_target") {
    targetText = row.kind === "cash" ? "普通买入目标已经算出，但现金无法覆盖整笔差额，所以不下这笔买单。" : "以上季调仓后 ETF 市值为基数，计算本季增长目标。调仓后 ETF 占比可以偏离初始比例。";
    targetFormula = `ETF 目标 = ${money(row.previous_etf, 2)} × ${1 + c.target_growth / 100} = ${money(b.planned_target, 2)}；目标 − 当前市值 = ${money(b.requested_trade, 2)}。`;
  } else {
    targetText = "本季规则要求保持持仓，没有执行调仓目标。普通参考目标仅帮助判断信号。";
    targetFormula = row.target === null ? "首季不检查买卖信号。" : `普通参考目标 ${money(row.target, 2)}；实际继续持有 ${quantity(row.shares_before)} 股和 ${money(row.cash_before, 2)} 现金。`;
  }
  const cashCheck = row.kind === "cash" ? `需要现金 ${money(b.requested_trade, 2)} > 可用现金 ${money(row.cash_before, 2)}；不部分买入。` : b.requested_trade > 1e-8 ? `买入所需 ${money(b.requested_trade, 2)}，可用现金 ${money(row.cash_before, 2)}。` : "卖出所得全部转入现金；不计税费与滑点，允许碎股。";
  const steps = [
    ["按本季价格重估现有持仓", "先沿用上季持股数量与现金，再用本季价格计算 ETF 市值。价格变化会先改变资产占比。", `${quantity(row.shares_before)} 股 × ${money(row.etf_price, 2)} = ETF ${money(row.etf_before, 2)}；加现金 ${money(row.cash_before, 2)} = 总资产 ${money(b.total_before, 2)}。`, "这里的总资产是本季交易前资产，并非最初投入的本金。"],
    [row.label, decisionEvidence(row), `回撤状态：${b.active_before ? "开启" : "关闭"} → ${b.active_after ? "开启" : "关闭"}；剩余忽略卖出次数：${b.ignore_before} → ${b.ignore_after}。`, "判断顺序：新触发 30 Down → 100 Up → 回撤状态下的卖出信号 → 普通季度目标。次数按卖出信号消耗。"],
    [b.mode === "allocation_reset" ? "按初始比例计算再平衡目标" : "确定本季目标是否执行", targetText, targetFormula, row.kind === "cash" ? cashCheck : "普通季度增长目标与比例重置使用不同的计算基数，页面分别展示。"],
    [traded ? `${buy ? "买入" : "卖出"} ${quantity(Math.abs(row.trade_shares))} 股` : "本季没有实际买卖", traded ? `${buy ? "现金 → ETF" : "ETF → 现金"}：${money(Math.abs(row.trade_amount), 2)}。` : row.explanation, traded ? `交易股数 = (${money(b.execution_target, 2)} − ${money(row.etf_before, 2)}) ÷ ${money(row.etf_price, 2)} = ${shares(row.trade_shares)} 股。` : `持股不变 ${quantity(row.etf_shares)} 股；现金不变 ${money(row.cash_value, 2)}。`, traded || row.kind === "cash" ? cashCheck : "没有成交时，不把参考目标当成实际持仓。"],
    ["核对资产构成与下一季起点", `调仓后 ETF ${weight(b.weight_after)}，现金 ${weight(1 - b.weight_after)}。${b.mode === "allocation_reset" ? "已恢复本次设置的初始比例。" : "本季资产比例由实际持仓决定。"}`, `ETF ${money(row.etf_value, 2)} + 现金 ${money(row.cash_value, 2)} = ${money(row.total_value, 2)}，与本季调仓前总资产相等。`, `下一季普通目标以上述调仓后 ETF ${money(row.etf_value, 2)} 为基数。金额保留两位、股数保留四位用于展示；内部计算不按展示位数取整。`],
  ];
  const step = steps[state.rebalanceStep];
  $("process-count").textContent = `步骤 ${state.rebalanceStep + 1} / 5`;
  ["process-title", "process-description", "process-formula", "process-note"].forEach((id, i) => { $(id).textContent = step[i]; });
  for (const button of $("rebalance-steps").children) button.setAttribute("aria-pressed", String(Number(button.dataset.step) === state.rebalanceStep));
  $("process-prev").disabled = state.rebalanceStep === 0;
  $("process-next").disabled = state.rebalanceStep === 4;
  $("process-next").textContent = state.rebalanceStep === 4 ? "本季核对完成 ✓" : "下一步 →";
  $("rebalance-flow").textContent = traded ? `${buy ? "现金 → ETF" : "ETF → 现金"}　${money(Math.abs(row.trade_amount), 2)}　·　${buy ? "买入" : "卖出"} ${quantity(Math.abs(row.trade_shares))} 股` : "本季无资金划转 · ETF 股数与现金保持不变";
  for (const when of ["before", "after"]) {
    $("weight-" + when).textContent = `ETF ${weight(b["weight_" + when])} / 现金 ${weight(1 - b["weight_" + when])}`;
    $("weight-bar-" + when).style.width = `${b["weight_" + when] * 100}%`;
  }
  $("holdings-table").replaceChildren();
  for (const cells of [
    ["ETF 股数", quantity(row.shares_before), shares(row.trade_shares), quantity(row.etf_shares)],
    ["ETF 市值", money(row.etf_before, 2), money(row.trade_amount, 2), money(row.etf_value, 2)],
    ["现金", money(row.cash_before, 2), money(b.cash_change, 2), money(row.cash_value, 2)],
    ["总资产", money(b.total_before, 2), money(0, 2), money(row.total_value, 2)],
  ]) {
    const tr = document.createElement("tr");
    for (const value of cells) { const td = document.createElement("td"); td.textContent = value; tr.append(td); }
    $("holdings-table").append(tr);
  }
  $("rebalance-state").textContent = `30 Down 状态：${b.active_before ? "开启" : "关闭"} → ${b.active_after ? "开启" : "关闭"}　·　剩余忽略卖出 ${b.ignore_before} → ${b.ignore_after} 次${b.sell_signal_consumed ? "（本季消耗一次卖出信号）" : ""}。`;
}
function svgElement(name, attrs, text) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", name);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  if (text !== undefined) el.textContent = text;
  return el;
}
function drawChart() {
  if (!state.result) return;
  const svg = $("chart"), r = state.result, dd = state.chart === "drawdown";
  svg.replaceChildren();
  const plot = r.rows.map((row, i) => ({...row, index: i}));
  if (r.period.start !== plot[0].date) plot.unshift({date: r.period.start, total_value: r.config.initial_capital, benchmark_value: r.config.initial_capital, cash_value: r.config.initial_capital * (1 - r.config.etf_allocation / 100), drawdown: 0, benchmark_drawdown: 0, index: -1});
  const left = 70, top = 20, width = 808, height = 244;
  const fields = dd ? [["drawdown", "#176d60"], ["benchmark_drawdown", "#6e87b7"]] : [["total_value", "#176d60"], ["benchmark_value", "#6e87b7"], ["cash_value", "#b9cbbf"]];
  const all = plot.flatMap((row) => fields.map(([field]) => row[field]));
  const min = dd ? Math.min(-0.05, ...all) * 1.1 : 0;
  const max = dd ? 0 : Math.max(...all) * 1.12;
  const x = (i) => left + i / (plot.length - 1) * width;
  const y = (v) => top + (max - v) / (max - min) * height;
  for (let i = 0; i <= 4; i++) {
    const value = min + (max - min) * i / 4, py = y(value);
    svg.append(svgElement("line", {x1: left, y1: py, x2: left + width, y2: py, stroke: "#edf1f2", "stroke-width": 1}));
    const label = dd ? `${Math.round(value * 100)}%` : value >= 1e6 ? `$${(value / 1e6).toFixed(1)}m` : value >= 1000 ? `$${Math.round(value / 1000)}k` : `$${Math.round(value)}`;
    svg.append(svgElement("text", {x: left - 14, y: py + 4, fill: "#9ba6ac", "font-size": 10, "text-anchor": "end"}, label));
  }
  const labels = [...new Set([0, ...[1, 2, 3, 4].map((i) => Math.round((plot.length - 1) * i / 4))])];
  labels.forEach((i) => svg.append(svgElement("text", {x: x(i), y: top + height + 27, fill: "#97a4aa", "font-size": 10, "text-anchor": i === 0 ? "start" : i === plot.length - 1 ? "end" : "middle"}, plot[i].date.slice(0, 7))));
  fields.forEach(([field, color], index) => {
    const d = plot.map((row, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(2)},${y(row[field]).toFixed(2)}`).join(" ");
    if (index === 0) svg.append(svgElement("path", {d: `${d} L${x(plot.length - 1)},${top + height} L${left},${top + height} Z`, fill: "#176d60", opacity: "0.035"}));
    svg.append(svgElement("path", {d, fill: "none", stroke: color, "stroke-width": index === 0 ? 2.7 : 1.8, "stroke-dasharray": index === 1 ? "5 4" : "none", "stroke-linejoin": "round"}));
  });
  const selected = plot.findIndex((p) => p.index === state.selected), point = plot[selected];
  svg.append(svgElement("line", {x1: x(selected), x2: x(selected), y1: top, y2: top + height, stroke: "#a5bcb0", "stroke-dasharray": "3 4"}));
  svg.append(svgElement("circle", {cx: x(selected), cy: y(point[fields[0][0]]), r: 4, fill: "#176d60", stroke: "white", "stroke-width": 2}));
  $("cash-legend").hidden = dd;
  svg.onpointermove = (event) => {
    const rect = svg.getBoundingClientRect();
    const index = Math.max(0, Math.min(plot.length - 1, Math.round(((event.clientX - rect.left) / rect.width * 900 - left) / width * (plot.length - 1))));
    const row = plot[index];
    $("chart-tooltip").hidden = false;
    $("chart-tooltip").textContent = `${row.date} · 策略 ${dd ? percent(row.drawdown) : money(row.total_value)} · 全仓持有 ${dd ? percent(row.benchmark_drawdown) : money(row.benchmark_value)}`;
  };
  svg.onpointerleave = () => { $("chart-tooltip").hidden = true; };
  svg.onclick = (event) => {
    const rect = svg.getBoundingClientRect();
    const index = Math.max(0, Math.min(plot.length - 1, Math.round(((event.clientX - rect.left) / rect.width * 900 - left) / width * (plot.length - 1))));
    selectQuarter(Math.max(0, plot[index].index));
  };
}
function exportResults() {
  if (!state.result || $("export").disabled) return;
  const fields = ["date", "quarter", "etf_price", "shares_before", "etf_before", "cash_before", "previous_etf", "target", "trade_shares", "trade_amount", "etf_shares", "etf_value", "cash_value", "total_value", "benchmark_value", "drawdown", "label", "explanation", "mode", "total_before", "weight_before", "weight_after", "planned_target", "execution_target", "requested_trade", "cash_change", "history_high", "drawdown_level", "quarter_growth", "active_before", "active_after", "ignore_before", "ignore_after"];
  const quote = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const csv = "\ufeff" + [fields.join(","), ...state.result.rows.map((row) => fields.map((field) => quote(field in row ? row[field] : row.rebalance[field])).join(","))].join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], {type: "text/csv;charset=utf-8"}));
  const link = document.createElement("a"); link.href = url; link.download = `9sig-${state.result.source.id === "demo" ? "DEMO-" : ""}${state.result.period.start}-${state.result.period.end}.csv`;
  link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function resetDefaults(run = true) {
  Object.entries(defaults).forEach(([key, value]) => { $(parameterFields[key]).value = value; });
  $("source").value = "demo"; $("upload-panel").hidden = true; $("csv-file").value = "";
  allocationLabels();
  if (await loadSource("demo")) { if (run) await runBacktest(); return true; }
  return false;
}
const tourSteps = [
  {target: "data-panel", title: "先用演示数据，认识整个流程", text: "已加载 25 条人工模拟价格，覆盖 2018 Q4 至 2024 Q4。这里没有接入真实行情。你可以下载 CSV，稍后用相同格式导入自己的数据。"},
  {target: "parameters-panel", title: "看清资金如何分配", text: "本次使用 $100,000，60% ETF、40% 现金，季度目标 9%。高级参数为 30% 回撤、回看 8 季、忽略 2 次卖出、单季大涨 100% 重置。点击下一步会实际运行回测。"},
  {target: "metrics", title: "回测已运行，先看整体结果", text: "上方四个指标来自这次实际计算。绿色线是策略总资产，蓝色虚线是同额本金的全仓 ETF 持有；两者风险敞口不同。点击“回撤”可切换图表。"},
  {target: "quarter-panel", title: "复盘一次卖出：2019 Q1", text: "价格从 $40 涨到 $50，1,500 股值 $75,000。季度目标是 $60,000 × 1.09 = $65,400，所以卖出 $9,600，即 192 股，现金变为 $49,600。"},
  {target: "rebalance-panel", title: "看清 30 Down 结束时的再平衡", text: "2021 Q1 触发后持有，Q2 忽略一次卖出，Q3 最后一次信号当季重置。总资产 $143,689.01 × 60% = ETF 目标 $86,213.40；卖出 $10,924.02，约 168.0619 股。退出演示后可点击 1—5 逐步核对。"},
  {target: "table-panel", title: "把结果带走，再换自己的数据", text: "点击“导出 CSV”保存本次逐季持仓与交易明细。接着选择“上传自己的 CSV”，上传 Date、ETF_Price 两列数据，检查区间与参数，再次运行。完整指南包含格式和常见问题。"},
];
async function showTour(index) {
  if (index < 0 || index >= tourSteps.length) { closeTour(); return; }
  $("tour-next").disabled = true;
  try {
    if (index === 2 && !(await runBacktest())) return;
    if (index >= 3 && (!state.result || !$("stale-note").hidden)) { if (!(await runBacktest())) return; }
    if (index === 3) selectQuarter(1);
    if (index === 4) { selectQuarter(Math.max(0, state.result.rows.findIndex((row) => row.action === "30-Down Complete & Rebalance"))); state.rebalanceStep = 2; renderRebalance(); }
    state.tour = index;
    const step = tourSteps[index];
    document.querySelectorAll(".tour-focus").forEach((el) => el.classList.remove("tour-focus"));
    $(step.target).classList.add("tour-focus");
    $(step.target).scrollIntoView({behavior: "smooth", block: "center"});
    $("tour").hidden = false; $("tour-count").textContent = `操作演示 · ${index + 1} / ${tourSteps.length}`;
    $("tour-title").textContent = step.title; $("tour-description").textContent = step.text;
    $("tour-prev").disabled = index === 0;
    $("tour-next").textContent = index === tourSteps.length - 1 ? "完成演示 ✓" : "下一步 →";
    $("tour-progress").replaceChildren(...tourSteps.map((_step, i) => { const span = document.createElement("span"); if (i <= index) span.className = "done"; return span; }));
  } finally { $("tour-next").disabled = false; }
}
function closeTour() { state.tour = -1; $("tour").hidden = true; document.querySelectorAll(".tour-focus").forEach((el) => el.classList.remove("tour-focus")); }
$("settings").addEventListener("submit", (event) => { event.preventDefault(); runBacktest(); });
$("settings").addEventListener("input", (event) => { if (event.target.id !== "csv-file") { if (state.tour >= 0) closeTour(); dirty(); allocationLabels(); } });
$("source").addEventListener("change", async () => {
  closeTour(); $("upload-panel").hidden = $("source").value !== "upload";
  if ($("source").value === "demo") { await loadSource("demo"); return; }
  dirty(); state.source = "upload"; state.csv = null; state.ready = false;
  $("csv-file").value = ""; $("run").disabled = true; $("data-label").textContent = "请选择 CSV 文件"; $("data-range").textContent = "";
});
$("csv-file").addEventListener("change", async () => {
  const file = $("csv-file").files[0];
  if (!file) return;
  dirty(); state.ready = false; $("run").disabled = true;
  if (file.size > 2 * 1024 * 1024) { showError("CSV 文件不能超过 2 MiB。"); return; }
  try { await loadSource("upload", await file.text(), file.name); } catch { showError("无法读取 CSV 文件，请使用 UTF-8 编码保存后重试。"); }
});
$("reset").addEventListener("click", () => { closeTour(); resetDefaults(); });
$("quarter-slider").addEventListener("input", (event) => selectQuarter(event.target.value));
$("quarter-prev").addEventListener("click", () => selectQuarter(state.selected - 1));
$("quarter-next").addEventListener("click", () => selectQuarter(state.selected + 1));
$("rebalance-steps").addEventListener("click", (event) => { const button = event.target.closest("button[data-step]"); if (button) { state.rebalanceStep = Number(button.dataset.step); renderRebalance(); } });
$("process-prev").addEventListener("click", () => { state.rebalanceStep = Math.max(0, state.rebalanceStep - 1); renderRebalance(); });
$("process-next").addEventListener("click", () => { state.rebalanceStep = Math.min(4, state.rebalanceStep + 1); renderRebalance(); });
$("export").addEventListener("click", exportResults);
$("comparison-export").addEventListener("click", exportCashComparison);
$("comparison-slider").addEventListener("input", (event) => selectComparisonQuarter(event.target.value));
for (const [id, mode] of [["comparison-return", "total_return"], ["comparison-drawdown", "drawdown"]]) $(id).addEventListener("click", () => {
  state.comparisonChart = mode;
  for (const button of [$("comparison-return"), $("comparison-drawdown")]) { const active = button.id === id; button.classList.toggle("selected", active); button.setAttribute("aria-pressed", String(active)); }
  selectComparisonQuarter(state.comparisonIndex);
});
for (const [id, mode] of [["show-value", "value"], ["show-drawdown", "drawdown"]]) $(id).addEventListener("click", () => {
  state.chart = mode;
  for (const button of [$("show-value"), $("show-drawdown")]) { const active = button.id === id; button.classList.toggle("selected", active); button.setAttribute("aria-pressed", String(active)); }
  drawChart();
});
document.querySelectorAll("[data-tour]").forEach((button) => button.addEventListener("click", async () => { if (state.busy) return; closeTour(); if (await resetDefaults(false)) await showTour(0); }));
$("tour-next").addEventListener("click", () => showTour(state.tour + 1));
$("tour-prev").addEventListener("click", () => showTour(state.tour - 1));
$("tour-close").addEventListener("click", closeTour);
document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeTour(); });
fetch("/healthz").then((r) => { if (!r.ok) throw new Error(); $("service-status").textContent = "回测服务在线"; }).catch(() => { $("service-status").textContent = "服务暂不可用"; });
resetDefaults().then((ready) => {
  if (!ready) return;
  const query = new URLSearchParams(location.search);
  if (query.get("demo") === "1") showTour(0);
  else if (query.get("compare") === "1") $("cash-comparison").scrollIntoView({block: "start"});
  else if (query.get("rebalance") === "1") {
    const index = state.result.rows.findIndex((row) => row.action === "30-Down Complete & Rebalance");
    if (index >= 0) selectQuarter(index);
    $("rebalance-panel").scrollIntoView({block: "start"});
  }
});
