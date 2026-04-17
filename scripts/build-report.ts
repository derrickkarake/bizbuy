/**
 * Build a human-readable report from data/shortlist-v2.csv:
 *  - data/report.md   — markdown (top 20, breakdowns, histograms)
 *  - data/report.html — rendered, sortable table, bar charts (Chart.js)
 */
import fs from 'fs';
import path from 'path';

const SRC = path.resolve(__dirname, '../data/shortlist-v2.csv');
const OUT_MD = path.resolve(__dirname, '../data/report.md');
const OUT_HTML = path.resolve(__dirname, '../data/report.html');

function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c === '\r') { /* skip */ }
      else field += c;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

const text = fs.readFileSync(SRC, 'utf8');
const rows = parseCSV(text);
const header = rows[0];
const idx = Object.fromEntries(header.map((h, i) => [h, i]));
const data = rows.slice(1).filter((r) => r[idx['url']]);

type Rec = {
  score: number;
  id: string;
  title: string;
  state: string;
  industry: string;
  ask: number | null;
  cf: number | null;
  revenue: number | null;
  multiple: number | null;
  margin: number | null;
  employees: number | null;
  location: string;
  flags: string;
  url: string;
};

const records: Rec[] = data.map((r) => ({
  score: Number(r[idx['score_v2']] ?? r[idx['score']] ?? 0),
  id: r[idx['listing_id']],
  title: r[idx['title']],
  state: r[idx['state']],
  industry: r[idx['industry']],
  ask: r[idx['asking_price']] ? Number(r[idx['asking_price']]) : null,
  cf: r[idx['cash_flow_sde']] ? Number(r[idx['cash_flow_sde']]) : null,
  revenue: r[idx['gross_revenue']] ? Number(r[idx['gross_revenue']]) : null,
  multiple: r[idx['sde_multiple']] ? Number(r[idx['sde_multiple']]) : null,
  margin: r[idx['sde_margin']] ? Number(r[idx['sde_margin']]) : null,
  employees: r[idx['employees']] ? Number(r[idx['employees']]) : null,
  location: r[idx['location']],
  flags: r[idx['flags_v2']] ?? r[idx['flags']] ?? '',
  url: r[idx['url']],
}));

records.sort((a, b) => b.score - a.score);

// Breakdowns
const byState: Record<string, Rec[]> = {};
const byIndustry: Record<string, Rec[]> = {};
for (const r of records) {
  (byState[r.state] ||= []).push(r);
  (byIndustry[r.industry] ||= []).push(r);
}

function avgScore(rs: Rec[]): number {
  if (!rs.length) return 0;
  return rs.reduce((s, r) => s + r.score, 0) / rs.length;
}

// Histogram of scores in bins of 5
const bins: Record<string, number> = {};
for (const r of records) {
  const low = Math.floor(r.score / 5) * 5;
  const key = `${low}-${low + 4}`;
  bins[key] = (bins[key] ?? 0) + 1;
}

function histBar(count: number, max: number, width = 40): string {
  const len = Math.round((count / max) * width);
  return '█'.repeat(len) + '·'.repeat(width - len);
}
const maxBinCount = Math.max(...Object.values(bins));
const binLines = Object.keys(bins)
  .sort((a, b) => Number(a.split('-')[0]) - Number(b.split('-')[0]))
  .reverse()
  .map((k) => `  ${k.padStart(6)} │ ${histBar(bins[k], maxBinCount, 40)} ${bins[k]}`)
  .join('\n');

// ========== MARKDOWN REPORT ==========
const withCashFlow = records.filter((r) => r.cf !== null).length;
const withAsk = records.filter((r) => r.ask !== null).length;
const deferred = records.filter((r) => r.ask === null).length;

let md = `# BizBuySell first-pass report (rubric v2)

_Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')}_

## Totals

| metric | count |
|---|---|
| Unique listings scored | ${records.length} |
| Have cash flow on card | ${withCashFlow} |
| Have asking price | ${withAsk} |
| Deferred (price hidden) | ${deferred} |

**Caveat**: detail pages were blocked by the rate limit — scoring used card-level data only (title, cash flow, location, industry, state). Detail-only pass after the IP cools off will unlock description-text keywords (recurring %, qualifier staying, customer concentration, margin from revenue).

## Score distribution

\`\`\`
${binLines}
\`\`\`

## By state

| state | listings | avg score |
|---|---|---|
${Object.entries(byState)
  .sort((a, b) => b[1].length - a[1].length)
  .map(([s, rs]) => `| ${s} | ${rs.length} | ${avgScore(rs).toFixed(1)} |`)
  .join('\n')}

## By industry

| industry | listings | avg score |
|---|---|---|
${Object.entries(byIndustry)
  .sort((a, b) => avgScore(b[1]) - avgScore(a[1]))
  .map(([i, rs]) => `| ${i} | ${rs.length} | ${avgScore(rs).toFixed(1)} |`)
  .join('\n')}

## Top 25

| # | score | state | industry | cash flow | location | title |
|---|---|---|---|---|---|---|
${records
  .slice(0, 25)
  .map((r, i) => {
    const cf = r.cf !== null ? `$${r.cf.toLocaleString()}` : '—';
    const t = r.title.replace(/\|/g, '/').slice(0, 70);
    return `| ${i + 1} | ${r.score} | ${r.state} | ${r.industry} | ${cf} | ${r.location || '—'} | [${t}](${r.url}) |`;
  })
  .join('\n')}

## Soft-red-flag summary (top 25)

${records.slice(0, 25).filter((r) => r.flags).map((r, i) => `- **#${records.indexOf(r) + 1}** ${r.title.slice(0, 60)} — ${r.flags}`).join('\n') || '(none)'}
`;

fs.writeFileSync(OUT_MD, md);

// ========== HTML REPORT ==========
const top30 = records.slice(0, 30);
const stateLabels = Object.keys(byState);
const stateCounts = stateLabels.map((s) => byState[s].length);
const indLabels = Object.keys(byIndustry);
const indAvg = indLabels.map((i) => Number(avgScore(byIndustry[i]).toFixed(1)));
const indCounts = indLabels.map((i) => byIndustry[i].length);
const binLabels = Object.keys(bins).sort(
  (a, b) => Number(a.split('-')[0]) - Number(b.split('-')[0]),
);
const binValues = binLabels.map((k) => bins[k]);

const html = `<!doctype html>
<html><head><meta charset="utf-8"/>
<title>BizBuySell first-pass report (rubric v2)</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
<style>
  body { font: 14px/1.5 -apple-system, system-ui, sans-serif; max-width: 1200px; margin: 2rem auto; padding: 0 1rem; color: #222; }
  h1 { font-size: 1.5rem; } h2 { margin-top: 2.5rem; border-bottom: 1px solid #ddd; padding-bottom: .3rem; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; }
  .card { border: 1px solid #e0e0e0; border-radius: 8px; padding: 1rem; background: #fafafa; }
  table { border-collapse: collapse; width: 100%; margin: 1rem 0; font-size: 13px; }
  th, td { padding: 6px 10px; border-bottom: 1px solid #eee; text-align: left; }
  th { background: #f4f4f4; cursor: pointer; user-select: none; position: sticky; top: 0; }
  th:hover { background: #e8e8e8; }
  tr:hover { background: #fffbe8; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .pill { display: inline-block; padding: 1px 7px; border-radius: 10px; font-size: 11px; background: #e8f0ff; color: #1746a2; margin-right: 3px; }
  .pill.red { background: #ffe8e8; color: #a21717; }
  .pill.warn { background: #fff4e0; color: #7a4d00; }
  .score { font-weight: 600; font-size: 15px; padding: 2px 8px; border-radius: 4px; display: inline-block; min-width: 28px; text-align: center; }
  .score.hi { background: #d4edda; color: #155724; }
  .score.mid { background: #fff3cd; color: #7a4d00; }
  .score.lo { background: #f1f1f1; color: #555; }
  .muted { color: #888; }
  a { color: #1746a2; text-decoration: none; }
  a:hover { text-decoration: underline; }
  canvas { max-height: 260px; }
</style></head>
<body>

<h1>BizBuySell first-pass report — rubric v2</h1>
<p class="muted">Generated ${new Date().toLocaleString()} · ${records.length} scored listings · OK/TX/AR × 6 industries · card-level data only (detail blocked by rate limit)</p>

<h2>Snapshot</h2>
<div class="grid">
  <div class="card"><strong>Totals</strong><br>
    <div>Unique listings: <b>${records.length}</b></div>
    <div>With cash flow: <b>${withCashFlow}</b></div>
    <div>With asking price: <b>${withAsk}</b></div>
    <div>Deferred (no price): <b>${deferred}</b></div>
  </div>
  <div class="card"><strong>Top score</strong><br>
    <div>Max: <b>${records[0].score}</b></div>
    <div>Median: <b>${records[Math.floor(records.length / 2)].score}</b></div>
    <div>Mean: <b>${(records.reduce((s, r) => s + r.score, 0) / records.length).toFixed(1)}</b></div>
  </div>
</div>

<h2>Score distribution</h2>
<div class="card"><canvas id="histChart"></canvas></div>

<h2>By state</h2>
<div class="grid">
  <div class="card"><canvas id="stateChart"></canvas></div>
  <div class="card"><canvas id="indChart"></canvas></div>
</div>

<h2>Top 30</h2>
<table id="topTable">
<thead><tr>
  <th>#</th><th>score</th><th>state</th><th>industry</th>
  <th class="num">cash flow</th><th class="num">asking</th>
  <th class="num">SDE mult</th><th>location</th><th>title</th><th>flags</th>
</tr></thead>
<tbody>
${top30
  .map((r, i) => {
    const cls = r.score >= 35 ? 'hi' : r.score >= 25 ? 'mid' : 'lo';
    const cf = r.cf !== null ? '$' + r.cf.toLocaleString() : '<span class="muted">—</span>';
    const ask = r.ask !== null ? '$' + r.ask.toLocaleString() : '<span class="muted">—</span>';
    const mult = r.multiple !== null ? r.multiple.toFixed(2) + 'x' : '<span class="muted">—</span>';
    const flagPills = r.flags
      ? r.flags
          .split('|')
          .map((f) => {
            const cls2 = f.startsWith('dq') ? 'red' : f.startsWith('red:') ? 'red' : f.startsWith('no-') ? 'warn' : 'warn';
            return `<span class="pill ${cls2}">${f}</span>`;
          })
          .join('')
      : '';
    return `<tr>
      <td>${i + 1}</td>
      <td><span class="score ${cls}">${r.score}</span></td>
      <td>${r.state}</td><td>${r.industry}</td>
      <td class="num">${cf}</td><td class="num">${ask}</td><td class="num">${mult}</td>
      <td>${r.location ?? '—'}</td>
      <td><a href="${r.url}" target="_blank">${r.title.slice(0, 75)}</a></td>
      <td>${flagPills}</td>
    </tr>`;
  })
  .join('\n')}
</tbody></table>

<script>
  new Chart(document.getElementById('histChart'), {
    type: 'bar',
    data: { labels: ${JSON.stringify(binLabels)}, datasets: [{ label: 'listings', data: ${JSON.stringify(binValues)}, backgroundColor: '#4a7fd1' }] },
    options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
  });
  new Chart(document.getElementById('stateChart'), {
    type: 'bar',
    data: { labels: ${JSON.stringify(stateLabels)}, datasets: [{ label: 'listings', data: ${JSON.stringify(stateCounts)}, backgroundColor: '#6bb26b' }] },
    options: { plugins: { title: { display: true, text: 'Listings by state' } }, scales: { y: { beginAtZero: true } } }
  });
  new Chart(document.getElementById('indChart'), {
    type: 'bar',
    data: { labels: ${JSON.stringify(indLabels)},
      datasets: [
        { label: 'count', data: ${JSON.stringify(indCounts)}, backgroundColor: '#6bb26b', yAxisID: 'y' },
        { label: 'avg score', data: ${JSON.stringify(indAvg)}, backgroundColor: '#d18a4a', yAxisID: 'y1' }
      ]
    },
    options: {
      plugins: { title: { display: true, text: 'Industry mix & avg score' } },
      scales: { y: { beginAtZero: true, position: 'left' }, y1: { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false } } }
    }
  });

  // click-to-sort
  document.querySelectorAll('#topTable th').forEach((th, i) => {
    let asc = true;
    th.addEventListener('click', () => {
      const tb = document.querySelector('#topTable tbody');
      const trs = Array.from(tb.querySelectorAll('tr'));
      trs.sort((a, b) => {
        const av = a.children[i].innerText;
        const bv = b.children[i].innerText;
        const an = parseFloat(av.replace(/[^-\\d.]/g, ''));
        const bn = parseFloat(bv.replace(/[^-\\d.]/g, ''));
        if (!isNaN(an) && !isNaN(bn)) return asc ? an - bn : bn - an;
        return asc ? av.localeCompare(bv) : bv.localeCompare(av);
      });
      asc = !asc;
      trs.forEach((tr) => tb.appendChild(tr));
    });
  });
</script>
</body></html>`;

fs.writeFileSync(OUT_HTML, html);
console.log(`wrote ${path.relative(process.cwd(), OUT_MD)}`);
console.log(`wrote ${path.relative(process.cwd(), OUT_HTML)}`);
