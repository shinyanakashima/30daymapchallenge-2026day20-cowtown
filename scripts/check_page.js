// Open the page in Chromium, fail on console errors or failed requests,
// and save screenshots.  Usage: node scripts/check_page.js <url> [outdir]
const { chromium } = require("playwright");

(async () => {
  const url = process.argv[2] || "http://localhost:8765/";
  const out = process.argv[3] || "docs";
  const browser = await chromium.launch();
  const problems = [];
  async function open(opts, lang) {
    const page = await browser.newPage(opts);
    page.on("console", (m) => { if (m.type() === "error") problems.push(`console: ${m.text()}`); });
    page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
    page.on("response", (r) => { if (r.status() >= 400) problems.push(`${r.status()} ${r.url()}`); });
    page.on("requestfailed", (r) => problems.push(`failed: ${r.url()} ${r.failure() && r.failure().errorText}`));
    await page.goto(url + (lang ? `?lang=${lang}` : ""), { waitUntil: "networkidle" });
    await page.waitForSelector(".hex path");
    return page;
  }
  const desk = await open({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1 });
  console.log("headline:", await desk.textContent("#headline"));
  console.log("hexagons:", await desk.locator(".hex path").count());
  await desk.screenshot({ path: `${out}/screenshot.png` });
  if (process.argv[4]) {
    const dir = process.argv[4];
    await desk.click('[data-view="geo"]'); await desk.waitForTimeout(500);
    await desk.screenshot({ path: `${dir}/geo.png` });
    const ja = await open({ viewport: { width: 1200, height: 900 } }, "ja");
    await ja.screenshot({ path: `${dir}/ja.png`, fullPage: true });
    const phone = await open({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    await phone.tap(".hex path >> nth=40");
    await phone.screenshot({ path: `${dir}/phone.png`, fullPage: true });
  }
  await browser.close();
  if (problems.length) { console.error(problems.join("\n")); process.exit(1); }
  console.log("no console errors, no failed requests");
})();
