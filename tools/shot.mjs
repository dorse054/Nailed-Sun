// Screenshot helper for development: node tools/shot.mjs <url> <out.png> [waitMs] [w] [h] [script]
import { chromium } from 'playwright';
const [url, out, wait = '3000', w = '1400', h = '860', script = ''] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ viewport: { width: Number(w), height: Number(h) }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
const page = await context.newPage();
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));
await page.goto(url);
await page.waitForTimeout(Number(wait));
if (script) {
  await page.evaluate(script);
  await page.waitForTimeout(1500);
}
await page.screenshot({ path: out });
console.log(logs.slice(-30).join('\n'));
await browser.close();
