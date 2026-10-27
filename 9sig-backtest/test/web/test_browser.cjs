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
  await check("parameter edits mark old results and recompute", async () => {
    const old = await page.locator("#final-value").innerText();
    await page.locator("#allocation").fill("40");
    assert(await page.locator("#stale-note").isVisible());
    assert(await page.locator("#export").isDisabled());
    await page.locator("#run").click(); await complete();
    assert.notEqual(await page.locator("#final-value").innerText(), old);
    assert.match(await page.locator("#chart-subtitle").innerText(), /40% ETF \/ 60% 现金/);
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
  });
  await check("all six interactive tour steps execute", async () => {
    await page.locator(".page-heading [data-tour]").click();
    await page.locator("#tour").waitFor({state: "visible"});
    for (let i = 1; i <= 6; i++) {
      await page.waitForFunction((n) => document.getElementById("tour-count").textContent.includes(`${n} / 6`), i);
      if (i === 4) assert.equal(await page.locator("#detail-trade").innerText(), "-192.0000");
      if (i === 5) assert.match(await page.locator("#action-badge").innerText(), /30 Down 触发/);
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
  });
  await check("invalid CSV blocks computation and export", async () => {
    await page.locator("#csv-file").setInputFiles({name: "invalid.csv", mimeType: "text/csv", buffer: Buffer.from("Date,ETF_Price\n2024-03-31,0\n2024-06-30,50")});
    await page.locator("#error").waitFor({state: "visible"});
    assert.match(await page.locator("#error").innerText(), /正数/);
    assert(await page.locator("#run").isDisabled());
    assert(await page.locator("#export").isDisabled());
  });
  await check("network failure is visible and cannot export stale results", async () => {
    await page.locator("#reset").click(); await complete();
    await page.route("**/api/backtest", (route) => route.abort("failed"));
    await page.locator("#target-growth").fill("8");
    await page.locator("#run").click();
    await page.locator("#error").waitFor({state: "visible"});
    assert.match(await page.locator("#error").innerText(), /无法连接/);
    assert(await page.locator("#export").isDisabled());
    await page.unroute("**/api/backtest");
    await page.locator("#reset").click(); await complete();
  });
  await check("full guide and both real screenshots load", async () => {
    await page.goto(`${baseURL}/guide`, {waitUntil: "networkidle"});
    assert.equal(await page.locator(".guide-section").count(), 6);
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
