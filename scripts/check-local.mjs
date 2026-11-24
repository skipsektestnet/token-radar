// Token Radar — the 7 local gate checks, plus the §D additions (validation + farm verdicts).
// Run: node scripts/check-local.mjs [--out <output dir, default out>]
// Exits 0 when every check passes, 1 with the failing check named.
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { boardIssue, farmVerdict, parseSnapshot } from '../lib/model.ts';
import { buildDossier } from '../vendor/makefun-board.ts';

const out = (process.argv.find((a) => a.startsWith('--out=')) ?? '--out=out').slice('--out='.length);
const failures = [];
const check = (name, ok, detail) => {
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}${detail ? `: ${detail}` : ''}`);
  if (!ok) failures.push(name);
};

const read = (p) => readFileSync(join(out, p), 'utf8');
const dashFiles = ['dashboard/index.html', 'dashboard/app.css', 'dashboard/app.js'];
const dashBytes = dashFiles.reduce((s, f) => s + statSync(join(out, f)).size, 0);
const dashText = dashFiles.map(read).join('\n');
check('dashboard_files', dashFiles.every((f) => existsSync(join(out, f))) && !/https?:\/\//.test(dashText), `${dashBytes} B, no http(s):// in source`);

const board = JSON.parse(read('board.json')).rows;
const slugOk = board.every((r) => /^[a-z0-9][a-z0-9.-]*$/.test(r.slug));
check('board_file', board.length >= 100 && board.length <= 4000 && slugOk, `${board.length} rows, all slugs valid`);

const sortedOk = board.every((r, i) => r.rank === i + 1) && board.every((r, i) => i === 0 || r.implied_value_usd <= board[i - 1].implied_value_usd);
check('sorted_by_value', sortedOk && board[0].implied_value_usd !== board[board.length - 1].implied_value_usd, 'ranks 1..n, implied value non-increasing');

const snapshot = parseSnapshot(readFileSync(process.argv.find((a) => a.startsWith('--input='))?.slice('--input='.length) ?? '', 'utf8'));
const slugs = new Set(board.map((r) => r.slug));
check('coverage', snapshot.watchlist.every((s) => slugs.has(s)), `watchlist ${snapshot.watchlist.filter((s) => slugs.has(s)).length}/${snapshot.watchlist.length}`);

const stepsOk = board.every((r) => r.farm_steps.length >= 3 && r.farm_steps.length <= 12 && r.farm_steps.every((s) => s.length >= 20 && s.length <= 600));
check('farm_steps', stepsOk, 'all rows 3-12 steps @ 20-600 chars');

// Farm verdicts (§D3): present on every row and recomputable from the row's own figures.
const verdictOk = board.every((r) => {
  const v = farmVerdict({ tvl_usd: r.tvl_usd, chains: r.chains, category: r.category, name: r.name }, r.age_days, r.implied_value_usd);
  return r.farm_verdict && r.farm_verdict.total_cost_usd === v.total_cost_usd && r.farm_verdict.value_per_dollar === v.value_per_dollar && r.farm_verdict.verdict === v.verdict;
});
check('farm_verdicts', verdictOk, `${board.filter((r) => r.farm_verdict.verdict === 'Strong').length} Strong / ${board.filter((r) => r.farm_verdict.verdict === 'Worth a look').length} Worth a look / ${board.filter((r) => r.farm_verdict.verdict === 'Thin').length} Thin`);

// Launch odds (v2): present on every row, a probability with peer counts behind it,
// and the regression breakdown the page recomputes from.
const oddsOk = board.every((r) => {
  const o = r.launch_odds;
  const g = r.regression;
  return o && typeof o.odds === 'number' && o.odds >= 0 && o.odds <= 1
    && Number.isSafeInteger(o.live_peers) && Number.isSafeInteger(o.total_peers) && o.live_peers <= o.total_peers
    && g && typeof g.intercept === 'number' && typeof g.log_tvl === 'number' && typeof g.category_effect === 'number';
});
check('launch_odds', oddsOk, `odds 0-1 on all rows, peers counted, regression breakdown present`);

const pngSize = (buf) => ({ w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) });
const shots = readdirSync(join(out, 'screenshots')).filter((f) => f.endsWith('.png'));
const shotsOk = shots.length >= 3 && shots.every((f) => {
  const buf = readFileSync(join(out, 'screenshots', f));
  const { w, h } = pngSize(buf);
  return buf.length <= 524_288 && w === 1440 && h === 900;
});
check('screenshots', shotsOk, shots.map((f) => `${f} ${Math.round(statSync(join(out, 'screenshots', f)).size / 1024)} KiB`).join(', '));

// The validation summary (§D1/D2) rides in data.js.
const dataJs = read('data.js');
const hasValidation = /"validation":\{"splits":\["hash-parity","tvl-median"\],"folds":4/.test(dataJs);
check('validation_in_data', hasValidation, '2 splits x 2 folds embedded');

const dossierOnDisk = readFileSync(join(out, 'dossier.json'));
const rebuilt = buildDossier(out, { text_max_bytes: 65_536, screenshots: { max: 4, max_bytes: 524_288 }, dashboard: { max_files: 400, max_bytes: 4_194_304 } });
const dossier = JSON.parse(dossierOnDisk.toString('utf8'));
const textBytes = Buffer.byteLength(typeof dossier.text === 'string' ? dossier.text : JSON.stringify(dossier.text ?? ''));
check(
  'dossier_matches',
  dossierOnDisk.equals(Buffer.from(rebuilt)) && textBytes < 65_536 && dossierOnDisk.length < 1_572_864,
  `byte-identical rebuild, text ${textBytes} B < 65,536, dossier ${dossierOnDisk.length} B < 1.5 MiB`,
);

const gateIssue = boardIssue(board, snapshot);
check('board_issue', gateIssue === null, gateIssue ?? 'none');

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed: ${failures.join(', ')}`);
  process.exit(1);
}
console.log('\nall checks pass');
