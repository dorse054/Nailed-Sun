// Checks that every control on each screen can be reached: on screen and not
// covered, or inside something that scrolls. Runs at phone, landscape-phone
// and desktop sizes against a running dev server.
//
//   node tools/reach.mjs [url] ['[[360,640],[800,400]]']
//
// Prints each screen as ok, or the controls that can't be reached. Controls
// behind an open modal or clipped inside a scrolling panel count as reachable.
import { chromium } from 'playwright';

const URL = process.argv[2] ?? 'http://127.0.0.1:5173/';
const SIZES = process.argv[3] ? JSON.parse(process.argv[3]) : [[360, 640], [800, 400], [1280, 720]];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

function check() {
  const out = [];
  const vw = innerWidth;
  const vh = innerHeight;
  const scroller = (el) => {
    for (let a = el.parentElement; a; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (/(auto|scroll)/.test(cs.overflowY + cs.overflowX) && (a.scrollHeight > a.clientHeight + 1 || a.scrollWidth > a.clientWidth + 1)) return a;
    }
    return document.scrollingElement.scrollHeight > vh + 1 ? document.scrollingElement : null;
  };
  const veiled = (el) => {
    const modal = document.querySelector('.modal-veil');
    return modal && !modal.contains(el);
  };
  for (const el of document.querySelectorAll('button, a, input, select')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.pointerEvents === 'none' || veiled(el)) continue;
    // Folded away inside a closed <details> (its summary still counts).
    const folded = el.closest('details:not([open])');
    if (folded && !el.closest('summary')) continue;
    const name = `${el.tagName} "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 30)}"`;
    const off = r.bottom > vh + 1 || r.right > vw + 1 || r.top < -1 || r.left < -1;
    const sc = scroller(el);
    if (off) {
      if (!sc) out.push(`off screen, no scrolling: ${name} @${Math.round(r.left)},${Math.round(r.top)}`);
      continue;
    }
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const top = document.elementFromPoint(x, y);
    if (!top || el.contains(top) || top.contains(el)) continue;
    // Clipped by its own scrolling panel: reachable by scrolling it.
    if (sc && sc !== document.scrollingElement) {
      const b = sc.getBoundingClientRect();
      if (y < b.top || y > b.bottom || x < b.left || x > b.right) continue;
    }
    out.push(`covered: ${name} by ${top.tagName}.${String(top.className).trim()}`);
  }
  return out;
}

for (const [w, h] of SIZES) {
  const page = await (await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 900, isMobile: w < 900 })).newPage();
  const report = async (name) => {
    const issues = await page.evaluate(check);
    console.log(`${w}x${h} ${name}: ${issues.length ? '\n  ' + issues.slice(0, 10).join('\n  ') : 'ok'}`);
  };
  const fromMenu = async (name, go) => {
    await page.goto('about:blank');
    await page.goto(URL + '#');
    await page.waitForTimeout(900);
    await go();
    await page.waitForTimeout(700);
    await report(name);
  };
  // A hash change alone doesn't reload the page: start from a blank one.
  const open = async (hash, wait) => {
    await page.goto('about:blank');
    await page.goto(URL + hash);
    await page.waitForTimeout(wait);
  };
  await fromMenu('menu', async () => {});
  await fromMenu('settings', async () => page.click('text=Settings'));
  await fromMenu('custom battle', async () => page.click('text=Custom Battle'));
  await fromMenu('tutorials', async () => page.click('text=Tutorials'));
  await fromMenu('codex', async () => page.click('text=Codex'));
  await fromMenu('new campaign', async () => page.click('text=Campaign'));
  await fromMenu('chronicles', async () => page.click('text=Chronicles'));
  await fromMenu('legends', async () => page.click('.menu-item:has-text("Legends")'));
  await open('#quick', 1500);
  await report('deployment');
  // A battle under way, with a unit selected so its panel and abilities show.
  await page.click('text=Start the battle');
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    const s = globalThis.__ns;
    const u = s.battle.units.find((x) => x.side === s.side && x.def.abilities?.length) ?? s.battle.units.find((x) => x.side === s.side);
    if (u) s.overlay.selected.add(u.id);
    s.hud.value++;
  });
  await page.waitForTimeout(500);
  await report('battle');
  await page.click('text=Menu');
  await page.waitForTimeout(400);
  await report('battle menu');
  await page.click('text=Resume');
  // The battle report, after a battle ends.
  await page.evaluate(() => { const s = globalThis.__ns; s.battle.finish(s.side, 'rout'); });
  await page.waitForTimeout(700);
  await page.click('text=Battle report');
  await page.waitForTimeout(700);
  await report('results');
  for (const panel of ['faction', 'diplomacy', 'log', 'help', 'army', 'region']) {
    await open('#camp:hush', 2200);
    await page.click('.modal .btn.primary');
    await page.waitForTimeout(300);
    await page.evaluate((panel) => {
      const c = globalThis.__camp;
      const army = c.s.armies.find((a) => a.faction === c.player);
      if (panel === 'army') c.selectArmy(army.id);
      else if (panel === 'region') c.selectRegion(army.region);
      else c.panel.value = panel;
    }, panel);
    await page.waitForTimeout(500);
    await report(`campaign ${panel}`);
  }
  await page.close();
}
await browser.close();
