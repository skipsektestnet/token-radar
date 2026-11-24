// Token Radar — Playwright interaction tests + screenshot refresh (v2, radar-3).
// Serves an output dir over loopback, drives the dashboard in headless
// Chromium, and checks the page against board.json. Also refreshes the
// three committed screenshots (board, detail, filtered) from the current UI.
//
// Run: node scripts/test-playwright.mjs [--out out1] [--shots screenshots]
// Needs: playwright-core resolvable (e.g. /tmp/pwtest/node_modules) and a
// Chromium build in ~/.cache/ms-playwright (chromium-1148).
// Exits 0 when every check passes, 1 with the failing checks named.

import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');

const here = fileURLToPath(new URL('.', import.meta.url));
const root = join(here, '..');
const arg = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1];
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq === undefined ? fallback : eq.slice(name.length + 3);
};
const outDir = arg('out', join(root, 'out1'));
const shotsDir = arg('shots', join(root, 'screenshots'));
const CHROME = `${process.env.HOME}/.cache/ms-playwright/chromium-1148/chrome-linux/chrome`;

const board = JSON.parse(readFileSync(join(outDir, 'board.json'), 'utf8')).rows;
const bySlug = new Map(board.map((r) => [r.slug, r]));

const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png' };
const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname).replace(/^\/+/, '');
  const file = join(outDir, path === '' ? 'dashboard/index.html' : path);
  if (!file.startsWith(outDir) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const base = `http://127.0.0.1:${port}/dashboard/index.html`;

const failures = [];
const check = (name, ok, detail) => {
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}${detail ? `: ${detail}` : ''}`);
  if (!ok) failures.push(name);
};

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  // Resource 404s arrive here as "Failed to load resource" without a URL;
  // the requestfailed handler below judges them by URL (favicon excluded).
  if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(m.text());
});
page.on('requestfailed', (r) => {
  if (!r.url().includes('favicon.ico')) errors.push(`request failed: ${r.url()}`);
});

const rows = () => page.$$eval('table tbody tr', (trs) => trs.length);
const shot = async (name) => {
  mkdirSync(shotsDir, { recursive: true });
  await page.screenshot({ path: join(shotsDir, name) });
};

await page.goto(base, { waitUntil: 'networkidle' });
await page.waitForSelector('table tbody tr');

// 1. Integrity strip: snapshot, live count, held-out numbers from the new model.
const strip = (await page.textContent('.strip')) ?? '';
check('integrity_strip', /Held-out, 2 splits x 2 folds/.test(strip) && /1\.27/.test(strip) && /128 live-token/.test(strip), strip.slice(0, 120));

// 2. Board renders all rows.
check('board_rows', (await rows()) === 197, `${await rows()} rows`);

// 3. Search "veda" narrows to one row.
await page.fill('#q', 'veda');
await page.waitForFunction(() => document.querySelectorAll('table tbody tr').length === 1);
check('search_veda', (await rows()) === 1, '1 row');
await page.fill('#q', '');
await page.waitForFunction(() => document.querySelectorAll('table tbody tr').length === 197);

// 4. Category filter RWA.
await page.selectOption('#category', 'RWA');
await page.waitForFunction(() => document.querySelectorAll('table tbody tr').length === 16);
check('filter_rwa', (await rows()) === 16, '16 rows');
await page.selectOption('#category', 'all');
await page.waitForFunction(() => document.querySelectorAll('table tbody tr').length === 197);

// 5. Watchlist-only.
await page.check('#wl');
await page.waitForFunction(() => document.querySelectorAll('table tbody tr').length === 40);
check('watchlist_only', (await rows()) === 40, '40 rows');
await page.uncheck('#wl');
await page.waitForFunction(() => document.querySelectorAll('table tbody tr').length === 197);

// 6. Odds column: every row shows a percentage and the sort works.
const oddsCells = await page.$$eval('table tbody tr td:nth-child(9)', (tds) => tds.map((t) => t.textContent.trim()));
check('odds_column', oddsCells.length === 197 && oddsCells.every((t) => /^\d+%/.test(t)), `${oddsCells.length} cells, e.g. ${oddsCells[0]}`);
await page.click('thead tr th:nth-child(9) button');
await page.waitForFunction(() => document.querySelectorAll('table tbody tr').length === 197);
const firstOdds = await page.$eval('table tbody tr td:nth-child(9)', (t) => t.textContent.trim());
check('odds_sort', firstOdds.startsWith('77%'), `top odds ${firstOdds}`);
// Back to the default sort (implied value, descending) for the screenshots.
await page.click('thead tr th:nth-child(6) button');
await page.waitForFunction(() => document.querySelectorAll('table tbody tr').length === 197);

// 7. A Strong verdict exists and its row shows it.
const strongRow = board.find((r) => r.farm_verdict.verdict === 'Strong');
const strongShown = await page.$$eval('table tbody tr', (trs) => trs.some((tr) => tr.textContent.includes('Strong')));
check('strong_verdict', Boolean(strongRow) && strongShown, strongRow ? `rank ${strongRow.rank} ${strongRow.name}` : 'none');

// 8. Live tab.
await page.click('button:has-text("Live token")');
await page.waitForFunction(() => document.querySelectorAll('table tbody tr').length === 24);
check('live_tab', (await rows()) === 24, '24 rows');

// 9. Model tab: formula, coefficients, multiples, validation table, odds table.
await page.click('button:has-text("Model")');
await page.waitForSelector('.model .formula');
const modelText = (await page.textContent('.model')) ?? '';
check(
  'model_tab',
  /log\(implied\)/.test(modelText) && /Fitted coefficients/.test(modelText) && /Launch odds from the peers/.test(modelText) && /Held-out validation/.test(modelText) && /Farm verdicts/.test(modelText),
  'formula + coefficients + odds + validation present',
);
const valRows = await page.$$eval('.model table', (tables) => tables.map((t) => t.querySelectorAll('tbody tr').length));
check('validation_table', valRows.includes(4), `tables have rows ${valRows.join('/')}`);

// 10. Detail views: farm plan identical to board.json, recompute matches,
//     verdict matches, odds shown — for four protocols.
await page.click('button:has-text("Board")');
await page.waitForFunction(() => document.querySelectorAll('table tbody tr').length === 197);
const detailSlugs = ['steakhouse-financial', 'usdd', 'flying-tulip-ftusd', 'gauntlet'];
let detailOk = true;
let detailNote = '';
for (const slug of detailSlugs) {
  const want = bySlug.get(slug);
  if (!want) {
    detailOk = false;
    detailNote = `${slug} not on the board`;
    break;
  }
  await page.evaluate((s) => {
    const tr = [...document.querySelectorAll('table tbody tr')].find((t) => t.textContent.includes(s));
    if (tr) tr.click();
  }, want.name);
  await page.waitForSelector('dialog[open]');
  const dialogText = (await page.textContent('dialog')) ?? '';
  const steps = await page.$$eval('dialog ol.steps li', (lis) =>
    lis.map((li) => li.textContent.replace(/\s+/g, ' ').trim()),
  );
  const wantSteps = want.farm_steps.map((s) => {
    const at = s.indexOf(' Cost: ');
    const action = at >= 0 ? s.slice(0, at) : s;
    const tail = at >= 0 ? s.slice(at + 1) : '';
    // The page renders <b>action</b><span>tail</span> with no space between them.
    return `${action}${tail}`.replace(/\s+/g, ' ').trim();
  });
  const stepsOk = steps.length === wantSteps.length && steps.every((s, i) => s === wantSteps[i]);
  const recomputeOk = dialogText.includes('the same number board.json carries');
  const verdictOk = dialogText.includes(`Farm verdict: ${want.farm_verdict.verdict}`);
  const oddsOk = dialogText.includes('Launch odds (peers)') && dialogText.includes(`${want.launch_odds.live_peers} of ${want.launch_odds.total_peers}`);
  if (!stepsOk || !recomputeOk || !verdictOk || !oddsOk) {
    detailOk = false;
    detailNote = `${slug}: steps=${stepsOk} recompute=${recomputeOk} verdict=${verdictOk} odds=${oddsOk}`;
    break;
  }
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('dialog[open]'));
}
check('detail_views', detailOk, detailNote || '4 protocols: farm plan, recompute, verdict, odds all match');

// 11. No page errors (favicon 404 excluded).
check('no_page_errors', errors.length === 0, errors.slice(0, 3).join(' | ') || 'none');

// Screenshots (refresh the committed set from the current UI).
await page.goto(base, { waitUntil: 'networkidle' });
await page.waitForSelector('table tbody tr');
await shot('1-board.png');
await page.evaluate(() => {
  const tr = [...document.querySelectorAll('table tbody tr')].find((t) => t.textContent.includes('Steakhouse Financial'));
  if (tr) tr.click();
});
await page.waitForSelector('dialog[open]');
await shot('2-detail.png');
await page.keyboard.press('Escape');
await page.waitForFunction(() => !document.querySelector('dialog[open]'));
await page.selectOption('#category', 'RWA');
await page.waitForFunction(() => document.querySelectorAll('table tbody tr').length === 16);
await shot('3-filtered.png');
const shotSizes = ['1-board.png', '2-detail.png', '3-filtered.png'].map((f) => `${f} ${Math.round(statSync(join(shotsDir, f)).size / 1024)} KiB`);
check('screenshots', ['1-board.png', '2-detail.png', '3-filtered.png'].every((f) => statSync(join(shotsDir, f)).size <= 524_288), shotSizes.join(', '));

await browser.close();
server.close();

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed: ${failures.join(', ')}`);
  process.exit(1);
}
console.log('\nall checks pass');
