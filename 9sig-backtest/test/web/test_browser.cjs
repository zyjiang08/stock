/* Real browser acceptance. See README.md for setup and evidence handling. */
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || "playwright");
process.umask(0o077);
const root = path.resolve(__dirname, "../..");
const baseURL = process.env.BASE_URL || "http://127.0.0.1:8911";
const evidence = path.resolve(process.env.RESULT_DIR || path.join(__dirname, "results", new Date().toISOString().replace(/[-:.]/g, "")));
fs.mkdirSync(evidence, {recursive: true, mode: 0o700});
fs.chmodSync(evidence, 0o700);
const results = {started: new Date().toISOString(), baseURL, checks: [], pageErrors: [], unexpectedResponses: []};
let browser, page;
async function check(name, fn) {
  await fn(); results.checks.push({name, status: "PASS"}); console.log(`PASS ${name}`);
}
async function complete(target = page) {
  await target.waitForFunction(() => !document.getElementById("export").disabled && document.getElementById("results").getAttribute("aria-busy") === "false");
}
async function noOverflow(target) {
  const width = target.viewportSize().width;
  assert(await target.evaluate((expected) => document.documentElement.scrollWidth <= expected + 1, width), "Page overflows the requested viewport horizontally");
}
async function main() {
  browser = await chromium.launch({headless: true, executablePath: process.env.CHROME_BIN || "/home/harry/.local/bin/google-chrome", chromiumSandbox: true});
  results.browserVersion = browser.version();
  results.nodeVersion = process.version;
  const context = await browser.newContext({viewport: {width: 1440, height: 1100}, acceptDownloads: true, reducedMotion: "reduce"});
  page = await context.newPage();
  page.on("pageerror", (error) => results.pageErrors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400 && !response.url().endsWith("/api/preview")) results.unexpectedResponses.push({url: response.url(), status: response.status()});
  });
  await page.goto(baseURL, {waitUntil: "networkidle"});
  await complete();
  await check("default demo and manually verified 192-share sell", async () => {
    assert.match(await page.title(), /9Sig/);
    assert.match(await page.locator("#result-status").innerText(), /演示回测已完成/);
    assert.equal(await page.locator("#quarter-table tr").count(), 25);
    assert.equal(await page.locator("#detail-trade").innerText(), "-192.0000");
    assert.equal(await page.locator("#detail-cash").innerText(), "$49,600.00");
    assert.equal(await page.locator("#detail-target").innerText(), "$65,400.00");
    await noOverflow(page);
    await page.screenshot({path: path.join(evidence, "desktop.png")});
    if (process.env.CAPTURE_GUIDE === "1") { const dest = path.join(root, "web/assets/demo-overview.png"); fs.copyFileSync(path.join(evidence, "desktop.png"), dest); fs.chmodSync(dest, 0o644); }
  });
  await check("independent 40/50/60 cash column, matched quarterly charts and CSV", async () => {
    assert.equal(await page.locator(".comparison-card").count(), 3);
    const expected = [[40, "+202.05%", "-40.91%"], [50, "+159.00%", "-36.13%"], [60, "+119.93%", "-31.12%"]];
    for (const [cash, gain, dd] of expected) {
      const card = page.locator(`.comparison-card[data-cash="${cash}"]`);
      assert.equal(await card.locator(".comparison-total-return").innerText(), gain);
      assert.equal(await card.locator('[data-metric="max_drawdown"]').innerText(), dd);
    }
    assert.match(await page.locator("#comparison-context").innerText(), /模拟数据.*100,000.*25 个季度/);
    assert.equal(await page.locator("#comparison-chart path[fill='none']").count(), 3);
    await page.locator("#cash-comparison").screenshot({path: path.join(evidence, "cash-comparison.png")});
    if (process.env.CAPTURE_GUIDE === "1") { const dest = path.join(root, "web/assets/demo-cash-comparison.png"); fs.copyFileSync(path.join(evidence, "cash-comparison.png"), dest); fs.chmodSync(dest, 0o644); }
    await page.locator("#comparison-slider").fill("1");
    assert.match(await page.locator("#comparison-readout").innerText(), /40% 现金 · 收益 \+15.00%/);
    assert.match(await page.locator("#comparison-readout").innerText(), /50% 现金 · 收益 \+12.50%/);
    assert.match(await page.locator("#comparison-readout").innerText(), /60% 现金 · 收益 \+10.00%/);
    await page.locator("#comparison-drawdown").click();
    assert.equal(await page.locator("#comparison-drawdown").getAttribute("aria-pressed"), "true");
    await page.locator("#comparison-slider").fill("9");
    assert.match(await page.locator("#comparison-readout").innerText(), /40% 现金 · 回撤 -/);
    await page.locator("#comparison-return").click();
    const pending = page.waitForEvent("download");
    await page.locator("#comparison-export").click();
    const download = await pending;
    assert.match(download.suggestedFilename(), /cash-comparison-DEMO/);
    const output = path.join(evidence, download.suggestedFilename()); await download.saveAs(output);
    const lines = fs.readFileSync(output, "utf8").trim().split(/\r?\n/);
    assert.equal(lines.length, 4);
    const headers = lines[0].split(","), cashIndex = headers.indexOf("cash_allocation_pct"), gainIndex = headers.indexOf("total_return");
    assert(cashIndex >= 0 && gainIndex >= 0 && headers.includes("max_drawdown"));
    assert.deepEqual(lines.slice(1).map((line) => Number(line.split(",")[cashIndex].replaceAll('"', ''))), [40, 50, 60]);
    assert(Math.abs(Number(lines[1].split(",")[gainIndex].replaceAll('"', '')) - 2.0205228724545194) < 1e-10);
  });
  await check("chart switching and quarter selection", async () => {
    await page.locator("#show-drawdown").click();
    assert.equal(await page.locator("#show-drawdown").getAttribute("aria-pressed"), "true");
    assert.equal(await page.locator("#chart path[fill='none']").count(), 2);
    await page.locator("#show-value").click();
    await page.locator("#quarter-slider").fill("9");
    assert.match(await page.locator("#detail-title").innerText(), /2021 Q1/);
    assert.match(await page.locator("#action-badge").innerText(), /30 Down 触发/);
    assert.equal(await page.locator("#detail-trade").innerText(), "0");
    await page.locator("#quarter-panel").scrollIntoViewIfNeeded();
    await page.screenshot({path: path.join(evidence, "quarter-detail.png")});
    if (process.env.CAPTURE_GUIDE === "1") { const dest = path.join(root, "web/assets/demo-quarter.png"); fs.copyFileSync(path.join(evidence, "quarter-detail.png"), dest); fs.chmodSync(dest, 0o644); }
  });
  await check("rebalance walkthrough separates actual reset from quarterly target", async () => {
    await page.getByRole("button", {name: "30 Down 再平衡", exact: true}).click();
    assert.match(await page.locator("#detail-title").innerText(), /2021 Q3/);
    assert.equal(await page.locator("#detail-target").innerText(), "$86,213.40");
    assert.match(await page.locator("#detail-formula").innerText(), /78,188.16/);
    assert.match(await page.locator("#weight-after").innerText(), /ETF 60.00% \/ 现金 40.00%/);
    for (let i = 0; i < 5; i++) {
      assert.equal(await page.locator("#process-count").innerText(), `步骤 ${i + 1} / 5`);
      if (i === 1) assert.match(await page.locator("#process-description").innerText(), /1 → 0/);
      if (i === 2) assert.match(await page.locator("#process-formula").innerText(), /143,689.01.*60%.*86,213.40/);
      if (i === 3) assert.match(await page.locator("#process-title").innerText(), /168.0619/);
      if (i < 4) await page.locator("#process-next").click();
    }
    assert(await page.locator("#process-next").isDisabled());
    await page.locator('[data-step="2"]').click();
    await page.locator("#rebalance-panel").scrollIntoViewIfNeeded();
    await page.locator("#rebalance-panel").screenshot({path: path.join(evidence, "rebalance.png")});
    if (process.env.CAPTURE_GUIDE === "1") { const dest = path.join(root, "web/assets/demo-rebalance.png"); fs.copyFileSync(path.join(evidence, "rebalance.png"), dest); fs.chmodSync(dest, 0o644); }
    await page.locator("#quarter-prev").click();
    assert.match(await page.locator("#rebalance-state").innerText(), /2 → 1/);
    assert.equal(await page.locator("#detail-target").innerText(), "不调仓");
    await page.locator("#quarter-prev").click();
    assert.match(await page.locator("#rebalance-state").innerText(), /0 → 2/);
    await page.getByRole("button", {name: "100 Up 再平衡", exact: true}).click();
    assert.equal(await page.locator("#detail-target").innerText(), "$101,964.48");
    await page.getByRole("button", {name: "常规卖出", exact: true}).click();
    assert.match(await page.locator("#weight-after").innerText(), /56.87%/);
  });
  await check("parameter edits mark old results and recompute", async () => {
    const old = await page.locator("#final-value").innerText();
    const comparison = await page.locator("#comparison-cards").innerText();
    await page.locator("#allocation").fill("40");
    assert(await page.locator("#stale-note").isVisible());
    assert(await page.locator("#export").isDisabled());
    assert(await page.locator("#comparison-export").isDisabled());
    assert(await page.locator("#comparison-stale").isVisible());
    await page.locator("#run").click(); await complete();
    assert.notEqual(await page.locator("#final-value").innerText(), old);
    assert.match(await page.locator("#chart-subtitle").innerText(), /40% ETF \/ 60% 现金/);
    assert.equal(await page.locator("#comparison-cards").innerText(), comparison);
    assert(!(await page.locator("#comparison-stale").isVisible()));
    await page.getByRole("button", {name: "30 Down 再平衡", exact: true}).click();
    assert.match(await page.locator("#weight-after").innerText(), /ETF 40.00% \/ 现金 60.00%/);
    await page.locator('[data-step="2"]').click();
    assert.match(await page.locator("#process-formula").innerText(), /× 40%/);
  });
  await check("comparison uses shared capital, date window and growth rule", async () => {
    await page.locator("#initial-capital").fill("200000");
    await page.locator("#target-growth").fill("8");
    await page.locator("#start-date").fill("2023-01-01");
    await page.locator("#run").click(); await complete();
    assert.match(await page.locator("#comparison-context").innerText(), /2023-03-31.*200,000.*8 个季度/);
    assert.match(await page.locator("#comparison-rules").innerText(), /季度目标 8%/);
    assert.match(await page.locator('.comparison-card[data-cash="50"]').innerText(), /初始现金 \$100,000/);
    assert.equal(await page.locator("#comparison-slider").getAttribute("max"), "7");
    const response = await page.request.post(`${baseURL}/api/compare`, {data: {start_date: "2023-01-01", config: {initial_capital: 200000, target_growth: 8}}});
    assert(response.ok());
    const computed = await response.json();
    for (const strategy of computed.strategies) assert.equal(await page.locator(`.comparison-card[data-cash="${strategy.cash_allocation}"] .comparison-total-return`).innerText(), `${strategy.metrics.total_return >= 0 ? "+" : ""}${(strategy.metrics.total_return * 100).toFixed(2)}%`);
    await page.locator("#reset").click(); await complete();
  });
  await check("CSV export contains all 25 quarterly records", async () => {
    const pending = page.waitForEvent("download");
    await page.locator("#export").click();
    const download = await pending;
    assert.match(download.suggestedFilename(), /DEMO/);
    const output = path.join(evidence, download.suggestedFilename());
    await download.saveAs(output);
    const content = fs.readFileSync(output, "utf8").trim();
    assert.equal(content.split(/\r?\n/).length, 26);
    assert.match(content, /trade_shares/);
    assert.match(content, /execution_target/);
    assert.match(content, /ignore_before,ignore_after/);
  });
  await check("all six interactive tour steps execute", async () => {
    await page.locator(".page-heading [data-tour]").click();
    await page.locator("#tour").waitFor({state: "visible"});
    for (let i = 1; i <= 6; i++) {
      await page.waitForFunction((n) => document.getElementById("tour-count").textContent.includes(`${n} / 6`), i);
      if (i === 4) assert.equal(await page.locator("#detail-trade").innerText(), "-192.0000");
      if (i === 5) { assert.match(await page.locator("#action-badge").innerText(), /30 Down 结束并重置/); assert.match(await page.locator("#process-formula").innerText(), /86,213.40/); }
      await page.locator("#tour-next").click();
    }
    await page.locator("#tour").waitFor({state: "hidden"});
    assert.equal(await page.locator("#allocation").inputValue(), "60");
  });
  await check("user CSV upload produces independently checkable result", async () => {
    await page.locator("#source").selectOption("upload");
    await page.locator("#csv-file").setInputFiles(path.join(__dirname, "fixtures/prices.csv"));
    await page.waitForFunction(() => !document.getElementById("run").disabled);
    await page.locator("#run").click(); await complete();
    assert.match(await page.locator("#result-status").innerText(), /CSV 回测已完成/);
    assert.equal(await page.locator("#quarter-table tr").count(), 5);
    assert.equal(await page.locator("#detail-trade").innerText(), "-192.0000");
    assert(await page.getByRole("button", {name: "30 Down 再平衡", exact: true}).isDisabled());
    assert.match(await page.locator("#comparison-context").innerText(), /用户上传 CSV.*5 个季度/);
    assert.equal(await page.locator("#comparison-slider").getAttribute("max"), "4");
  });
  await check("cash shortfall and buy-direction reset explain actual money flow", async () => {
    await page.locator("#csv-file").setInputFiles({name: "reset-buy.csv", mimeType: "text/csv", buffer: Buffer.from("Date,ETF_Price\n2024-03-31,100\n2024-06-30,20\n2024-09-30,41")});
    await page.waitForFunction(() => !document.getElementById("run").disabled);
    await page.locator("#run").click(); await complete();
    assert.equal(await page.locator("#detail-target").innerText(), "不调仓");
    await page.locator('[data-step="2"]').click();
    assert.match(await page.locator("#process-note").innerText(), /53,400.00.*40,000.00/);
    await page.getByRole("button", {name: "100 Up 再平衡", exact: true}).click();
    assert.equal(await page.locator("#detail-target").innerText(), "$38,760.00");
    assert.match(await page.locator("#rebalance-flow").innerText(), /现金 → ETF.*14,160.00/);
  });
  await check("invalid CSV blocks computation and export", async () => {
    await page.locator("#csv-file").setInputFiles({name: "invalid.csv", mimeType: "text/csv", buffer: Buffer.from("Date,ETF_Price\n2024-03-31,0\n2024-06-30,50")});
    await page.locator("#error").waitFor({state: "visible"});
    assert.match(await page.locator("#error").innerText(), /正数/);
    assert(await page.locator("#run").isDisabled());
    assert(await page.locator("#export").isDisabled());
    assert(await page.locator("#comparison-export").isDisabled());
  });
  await check("network failure is visible and cannot export stale results", async () => {
    await page.locator("#reset").click(); await complete();
    await page.route("**/api/backtest", (route) => route.abort("failed"));
    await page.locator("#target-growth").fill("8");
    await page.locator("#run").click();
    await page.locator("#error").waitFor({state: "visible"});
    assert.match(await page.locator("#error").innerText(), /无法连接/);
    assert(await page.locator("#export").isDisabled());
    assert(await page.locator("#comparison-export").isDisabled());
    assert(await page.locator("#comparison-stale").isVisible());
    await page.unroute("**/api/backtest");
    await page.locator("#reset").click(); await complete();
  });
  await check("full guide and all four real screenshots load", async () => {
    await page.goto(`${baseURL}/guide`, {waitUntil: "networkidle"});
    assert.equal(await page.locator(".guide-section").count(), 8);
    assert.match(await page.locator("#rebalance").innerText(), /168.0619/);
    assert.match(await page.locator("#cash-comparison").innerText(), /60% 现金 \+ 40% ETF/);
    for (const image of await page.locator(".guide-section img").all()) {
      await image.scrollIntoViewIfNeeded();
      await image.evaluate((el) => el.decode());
      assert(await image.evaluate((el) => el.naturalWidth > 0));
    }
    await noOverflow(page);
    await page.screenshot({path: path.join(evidence, "guide.png")});
  });
  await check("mobile workspace, guide and walkthrough at 390px", async () => {
    const mobile = await browser.newContext({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true, reducedMotion: "reduce"});
    const phone = await mobile.newPage();
    phone.on("pageerror", (error) => results.pageErrors.push(error.message));
    await phone.goto(baseURL, {waitUntil: "networkidle"}); await complete(phone);
    await noOverflow(phone);
    await phone.screenshot({path: path.join(evidence, "mobile.png"), fullPage: true});
    await phone.goto(`${baseURL}/?compare=1#cash-comparison`, {waitUntil: "networkidle"}); await complete(phone);
    assert.equal(await phone.locator(".comparison-card").count(), 3);
    await noOverflow(phone);
    await phone.locator("#cash-comparison").screenshot({path: path.join(evidence, "mobile-cash-comparison.png")});
    await phone.locator("#comparison-drawdown").click();
    await phone.locator("#comparison-slider").fill("9");
    assert.match(await phone.locator("#comparison-readout").innerText(), /60% 现金 · 回撤 -/);
    await noOverflow(phone);
    await phone.goto(`${baseURL}/?rebalance=1#rebalance-panel`, {waitUntil: "networkidle"}); await complete(phone);
    assert.match(await phone.locator("#detail-title").innerText(), /2021 Q3/);
    await phone.locator('[data-step="3"]').click();
    assert.match(await phone.locator("#process-title").innerText(), /168.0619/);
    await noOverflow(phone);
    await phone.screenshot({path: path.join(evidence, "mobile-rebalance.png")});
    await phone.locator(".page-heading [data-tour]").click();
    await phone.locator("#tour").waitFor({state: "visible"});
    await noOverflow(phone);
    await phone.screenshot({path: path.join(evidence, "mobile-tour.png")});
    await phone.locator("#tour-close").click();
    await phone.goto(`${baseURL}/guide`, {waitUntil: "networkidle"});
    await noOverflow(phone);
    await phone.screenshot({path: path.join(evidence, "mobile-guide.png"), fullPage: true});
    await mobile.close();
  });
  assert.deepEqual(results.pageErrors, []);
  assert.deepEqual(results.unexpectedResponses, []);
  results.status = "PASS";
}
main().catch(async (error) => {
  results.status = "FAIL"; results.error = error.stack; console.error(error.stack);
  if (page && !page.isClosed()) await page.screenshot({path: path.join(evidence, "failure.png"), fullPage: true}).catch(() => {});
  process.exitCode = 1;
}).finally(async () => {
  results.finished = new Date().toISOString();
  fs.writeFileSync(path.join(evidence, "browser-results.json"), JSON.stringify(results, null, 2) + "\n", {mode: 0o600});
  if (browser) await browser.close();
});
