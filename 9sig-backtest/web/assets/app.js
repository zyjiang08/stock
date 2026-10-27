"use strict";
const $ = (id) => document.getElementById(id);
const money = (value, digits = 0) => Number.isFinite(value) ? new Intl.NumberFormat("en-US", {style: "currency", currency: "USD", maximumFractionDigits: digits, minimumFractionDigits: digits}).format(value) : "—";
const percent = (value) => Number.isFinite(value) ? `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%` : "区间不足一年";
const shares = (value) => Number.isFinite(value) ? `${value > 1e-8 ? "+" : ""}${Math.abs(value) < 1e-8 ? "0" : value.toFixed(4)}` : "—";
const state = {source: "demo", csv: null, ready: false, result: null, selected: 1, chart: "value", revision: 0, busy: false, tour: -1};
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
  const payload = {...sourcePayload(), config, start_date: $("start-date").value, end_date: $("end-date").value};
  const revision = state.revision;
  setBusy(true); showError(""); $("export").disabled = true;
  $("result-status").textContent = "正在计算季度信号…";
  try {
    const result = await api("/api/backtest", payload);
    if (revision !== state.revision) return false;
    state.result = result; state.selected = Math.min(1, result.rows.length - 1);
    renderResult();
    $("stale-note").hidden = true;
    $("export").disabled = false;
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
  $("quarter-slider").max = r.rows.length - 1;
  renderTable(); renderNotes(); selectQuarter(state.selected); drawChart();
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
  $("detail-target").textContent = money(row.target, 2);
  $("detail-trade").textContent = shares(row.trade_shares);
  $("detail-cash").textContent = money(row.cash_value, 2);
  let formula = row.previous_etf === null ? `初始 ${money(state.result.config.initial_capital)} × ${state.result.config.etf_allocation}% ÷ 首条价格，建立 ETF 持仓。` : `参考目标 = 上季 ETF ${money(row.previous_etf, 2)} × ${(1 + state.result.config.target_growth / 100).toFixed(4)} = ${money(row.target, 2)}。`;
  formula += ` 本季估值 ${money(row.etf_price, 2)} / 股；交易金额 ${money(row.trade_amount, 2)}（正数买入、负数卖出）。`;
  if (["drawdown", "reset", "skip"].includes(row.kind)) formula += " 本季按特殊规则处理，参考目标不等于实际成交目标。";
  $("detail-formula").textContent = formula;
  document.querySelectorAll("#quarter-table tr").forEach((tr) => tr.classList.toggle("selected", Number(tr.dataset.index) === state.selected));
  drawChart();
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
  const fields = ["date", "quarter", "etf_price", "shares_before", "etf_before", "previous_etf", "target", "trade_shares", "trade_amount", "etf_shares", "etf_value", "cash_value", "total_value", "benchmark_value", "drawdown", "label", "explanation"];
  const quote = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const csv = "\ufeff" + [fields.join(","), ...state.result.rows.map((row) => fields.map((field) => quote(row[field])).join(","))].join("\r\n");
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
  {target: "quarter-panel", title: "再看一次回撤规则触发", text: "现在选中了第一个 30 Down 触发季度。原引擎在触发当季不交易；后续忽略卖出信号，次数用完后按初始比例重置。滑动时间线，可逐季检查恢复过程。"},
  {target: "table-panel", title: "把结果带走，再换自己的数据", text: "点击“导出 CSV”保存本次逐季持仓与交易明细。接着选择“上传自己的 CSV”，上传 Date、ETF_Price 两列数据，检查区间与参数，再次运行。完整指南包含格式和常见问题。"},
];
async function showTour(index) {
  if (index < 0 || index >= tourSteps.length) { closeTour(); return; }
  $("tour-next").disabled = true;
  try {
    if (index === 2 && !(await runBacktest())) return;
    if (index >= 3 && (!state.result || !$("stale-note").hidden)) { if (!(await runBacktest())) return; }
    if (index === 3) selectQuarter(1);
    if (index === 4) selectQuarter(Math.max(0, state.result.rows.findIndex((row) => row.kind === "drawdown")));
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
$("export").addEventListener("click", exportResults);
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
resetDefaults().then(() => { if (new URLSearchParams(location.search).get("demo") === "1") showTour(0); });
