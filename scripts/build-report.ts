/**
 * Build a human-readable report from data/shortlist-v2.csv:
 *  - data/report.md   — markdown (top 20, breakdowns, histograms)
 *  - data/report.html — rendered, sortable table, bar charts (Chart.js)
 *  - index.html       — copy at repo root (GitHub Pages serves this)
 *
 * Layout: listings table is the hero — stats and charts are secondary.
 */
import fs from 'fs';
import path from 'path';

const SRC = path.resolve(__dirname, '../data/shortlist-v2.csv');
const OUT_MD = path.resolve(__dirname, '../data/report.md');
const OUT_HTML = path.resolve(__dirname, '../data/report.html');
const OUT_INDEX = path.resolve(__dirname, '../index.html');

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
  isMemo: boolean;
};

const records: Rec[] = data.map((r) => {
  const flags = r[idx['flags_v2']] ?? r[idx['flags']] ?? '';
  return {
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
    flags,
    url: r[idx['url']],
    isMemo: /memo-sourced|memo-verified/.test(flags),
  };
});

records.sort((a, b) => b.score - a.score);

const byState: Record<string, Rec[]> = {};
const byIndustry: Record<string, Rec[]> = {};
for (const r of records) {
  (byState[r.state] ||= []).push(r);
  (byIndustry[r.industry] ||= []).push(r);
}
const avgScore = (rs: Rec[]) => (rs.length ? rs.reduce((s, r) => s + r.score, 0) / rs.length : 0);

const bins: Record<string, number> = {};
for (const r of records) {
  const low = Math.floor(r.score / 5) * 5;
  bins[`${low}-${low + 4}`] = (bins[`${low}-${low + 4}`] ?? 0) + 1;
}

// ========== MARKDOWN ==========
const withCF = records.filter((r) => r.cf !== null).length;
const withAsk = records.filter((r) => r.ask !== null).length;
const deferred = records.filter((r) => r.ask === null).length;

const md = `# BizBuySell first-pass report (rubric v2)

_Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')}_

## Totals

| metric | count |
|---|---|
| Listings scored | ${records.length} |
| With cash flow | ${withCF} |
| With asking price | ${withAsk} |
| Deferred (price hidden) | ${deferred} |
| Memo-verified | ${records.filter((r) => r.isMemo).length} |

## Score distribution

${Object.keys(bins).sort((a, b) => Number(a.split('-')[0]) - Number(b.split('-')[0])).reverse().map((k) => `- ${k.padStart(6)}: ${bins[k]}`).join('\n')}

## By state

| state | listings | avg score |
|---|---|---|
${Object.entries(byState).sort((a, b) => b[1].length - a[1].length).map(([s, rs]) => `| ${s} | ${rs.length} | ${avgScore(rs).toFixed(1)} |`).join('\n')}

## By industry

| industry | listings | avg score |
|---|---|---|
${Object.entries(byIndustry).sort((a, b) => avgScore(b[1]) - avgScore(a[1])).map(([i, rs]) => `| ${i} | ${rs.length} | ${avgScore(rs).toFixed(1)} |`).join('\n')}

## Top 25

| # | score | state | industry | cash flow | asking | location | title |
|---|---|---|---|---|---|---|---|
${records.slice(0, 25).map((r, i) => {
  const cf = r.cf !== null ? `$${r.cf.toLocaleString()}` : '—';
  const ask = r.ask !== null ? `$${r.ask.toLocaleString()}` : '—';
  const t = r.title.replace(/\|/g, '/').slice(0, 70);
  return `| ${i + 1} | ${r.score} | ${r.state} | ${r.industry} | ${cf} | ${ask} | ${r.location || '—'} | [${t}](${r.url}) |`;
}).join('\n')}
`;
fs.writeFileSync(OUT_MD, md);

// ========== HTML ==========
const top30 = records.slice(0, 30);
const stateLabels = Object.keys(byState);
const stateCounts = stateLabels.map((s) => byState[s].length);
const indLabels = Object.keys(byIndustry);
const indAvg = indLabels.map((i) => Number(avgScore(byIndustry[i]).toFixed(1)));
const indCounts = indLabels.map((i) => byIndustry[i].length);
const binLabels = Object.keys(bins).sort((a, b) => Number(a.split('-')[0]) - Number(b.split('-')[0]));
const binValues = binLabels.map((k) => bins[k]);

const industryColors: Record<string, string> = {
  hvac: '#d97706',
  plumbing: '#2563eb',
  cleaning: '#059669',
  'pest-control': '#dc2626',
  electrical: '#ca8a04',
  landscaping: '#16a34a',
  service: '#64748b',
  'building-and-construction': '#7c3aed',
};

function industryPill(ind: string): string {
  const color = industryColors[ind] ?? '#64748b';
  return `<span class="ind-pill" style="background:${color}15;color:${color};border-color:${color}40">${ind}</span>`;
}

function flagPills(flags: string): string {
  if (!flags) return '';
  return flags.split('|').map((f) => {
    let cls = 'warn';
    if (f.includes('DQ') || f.includes('franchise')) cls = 'red';
    else if (f === 'memo-sourced' || f === 'memo-verified') cls = 'ok';
    else if (f === 'license-risk') cls = 'red';
    else if (f.startsWith('no-')) cls = 'muted';
    return `<span class="pill ${cls}">${f}</span>`;
  }).join('');
}

function renderRow(r: Rec, i: number): string {
  const cls = r.score >= 60 ? 'hi' : r.score >= 35 ? 'mid-hi' : r.score >= 25 ? 'mid' : 'lo';
  const cf = r.cf !== null ? '$' + r.cf.toLocaleString() : '<span class="muted">—</span>';
  const ask = r.ask !== null ? '$' + r.ask.toLocaleString() : '<span class="muted">—</span>';
  const mult = r.multiple !== null ? r.multiple.toFixed(2) + 'x' : '<span class="muted">—</span>';
  const marg = r.margin !== null ? (r.margin * 100).toFixed(0) + '%' : '<span class="muted">—</span>';
  const loc = r.location?.trim() || '<span class="muted">—</span>';
  return `<tr data-score="${r.score}" data-state="${r.state}" data-industry="${r.industry}" data-memo="${r.isMemo ? 1 : 0}">
    <td class="rank">${i + 1}</td>
    <td><span class="score ${cls}">${r.score}</span></td>
    <td>${industryPill(r.industry)}</td>
    <td><span class="state">${r.state}</span></td>
    <td class="num">${cf}</td>
    <td class="num">${ask}</td>
    <td class="num">${mult}</td>
    <td class="num">${marg}</td>
    <td>${loc}</td>
    <td class="title-cell"><a href="${r.url}" target="_blank" rel="noopener">${r.title.slice(0, 90)}</a></td>
    <td>${flagPills(r.flags)}</td>
  </tr>`;
}

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>BizBuySell Acquisition Targets — Rubric v2</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
<style>
  :root {
    --bg: #fafbfc;
    --card: #ffffff;
    --border: #e5e7eb;
    --text: #111827;
    --muted: #6b7280;
    --accent: #1746a2;
    --hi: #16a34a;
    --mid-hi: #65a30d;
    --mid: #ca8a04;
    --lo: #9ca3af;
  }
  * { box-sizing: border-box; }
  body {
    font: 14px/1.5 -apple-system, "SF Pro Text", system-ui, sans-serif;
    margin: 0; padding: 0; background: var(--bg); color: var(--text);
  }
  .wrap { max-width: 1400px; margin: 0 auto; padding: 2rem 1.5rem 4rem; }
  header { margin-bottom: 1.5rem; }
  h1 { font-size: 1.6rem; font-weight: 650; margin: 0 0 .3rem; letter-spacing: -0.01em; }
  .sub { color: var(--muted); font-size: 13px; }
  h2 { font-size: 1.05rem; font-weight: 600; margin: 2.5rem 0 .75rem; letter-spacing: -0.005em; }
  h2 .count { color: var(--muted); font-weight: 400; font-size: 0.9em; margin-left: .4rem; }

  /* KPI strip */
  .kpi-strip {
    display: grid; grid-template-columns: repeat(5, 1fr); gap: 0.75rem;
    margin: 0 0 1.25rem;
  }
  .kpi {
    background: var(--card); border: 1px solid var(--border);
    border-radius: 8px; padding: .75rem .9rem;
  }
  .kpi .label { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; }
  .kpi .value { font-size: 1.35rem; font-weight: 600; margin-top: .15rem; letter-spacing: -0.01em; }

  /* Filters */
  .toolbar {
    display: flex; gap: .5rem; flex-wrap: wrap; align-items: center;
    background: var(--card); border: 1px solid var(--border);
    border-radius: 8px 8px 0 0; border-bottom: none;
    padding: .6rem .75rem;
  }
  .toolbar input, .toolbar select {
    font: inherit; padding: .35rem .55rem;
    border: 1px solid var(--border); border-radius: 6px;
    background: #fff; color: var(--text);
  }
  .toolbar input { min-width: 200px; }
  .toolbar .count-live { color: var(--muted); margin-left: auto; font-size: 12px; }
  .toolbar label { display: flex; align-items: center; gap: .3rem; font-size: 12px; color: var(--muted); }

  /* Table */
  .table-wrap {
    background: var(--card); border: 1px solid var(--border);
    border-radius: 0 0 8px 8px; overflow: auto; max-height: 75vh;
  }
  table { border-collapse: separate; border-spacing: 0; width: 100%; font-size: 13px; }
  th, td { padding: 8px 10px; border-bottom: 1px solid var(--border); text-align: left; vertical-align: top; }
  th {
    background: #f8fafc; font-weight: 600; font-size: 12px;
    cursor: pointer; user-select: none; position: sticky; top: 0; z-index: 2;
    border-bottom: 1px solid var(--border);
  }
  th:hover { background: #eef2f7; }
  th.sorted::after { content: " ↓"; color: var(--accent); font-weight: 700; }
  th.sorted.asc::after { content: " ↑"; }
  tr:hover td { background: #fffbea; }
  tr:last-child td { border-bottom: none; }
  td.rank { color: var(--muted); font-variant-numeric: tabular-nums; width: 36px; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  td.title-cell { max-width: 380px; }
  td.title-cell a { color: var(--accent); text-decoration: none; }
  td.title-cell a:hover { text-decoration: underline; }

  .state { font-variant: small-caps; color: var(--muted); font-size: 12px; letter-spacing: 0.03em; }

  .score {
    display: inline-block; min-width: 30px; padding: 2px 8px;
    border-radius: 4px; font-weight: 600; font-size: 13px; text-align: center;
    font-variant-numeric: tabular-nums;
  }
  .score.hi { background: #dcfce7; color: #14532d; }
  .score.mid-hi { background: #ecfccb; color: #365314; }
  .score.mid { background: #fef3c7; color: #713f12; }
  .score.lo { background: #f3f4f6; color: #4b5563; }

  .ind-pill {
    display: inline-block; padding: 1px 7px; border-radius: 10px;
    font-size: 11px; font-weight: 500; border: 1px solid;
    white-space: nowrap;
  }
  .pill {
    display: inline-block; padding: 1px 6px; border-radius: 10px;
    font-size: 10.5px; margin: 1px 2px 1px 0; white-space: nowrap;
  }
  .pill.red { background: #fee2e2; color: #991b1b; }
  .pill.warn { background: #fef3c7; color: #713f12; }
  .pill.ok { background: #d1fae5; color: #065f46; }
  .pill.muted { background: #f3f4f6; color: #6b7280; }
  .muted { color: var(--muted); }

  /* Charts section */
  .charts {
    display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 1rem; margin-top: 1rem;
  }
  .chart-card {
    background: var(--card); border: 1px solid var(--border);
    border-radius: 8px; padding: .9rem 1rem .5rem;
  }
  .chart-card h3 {
    font-size: 12px; margin: 0 0 .4rem; font-weight: 600;
    color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em;
  }
  canvas { max-height: 220px; }

  /* Rubric section */
  .rubric-grid {
    display: grid; grid-template-columns: repeat(4, 1fr); gap: .75rem;
  }
  .rubric-card {
    background: var(--card); border: 1px solid var(--border);
    border-radius: 8px; padding: .85rem .9rem;
  }
  .rubric-card .pts {
    display: inline-block; background: var(--accent); color: #fff;
    font-size: 11px; font-weight: 600; padding: 1px 7px;
    border-radius: 10px; margin-left: .35rem;
    font-variant-numeric: tabular-nums;
  }
  .rubric-card h4 {
    margin: 0 0 .25rem; font-size: 13px; font-weight: 600;
    display: flex; align-items: center;
  }
  .rubric-card .why {
    color: var(--muted); font-size: 12px; margin: 0 0 .5rem; line-height: 1.4;
  }
  .rubric-card ul.tiers {
    margin: 0; padding: 0; list-style: none; font-size: 12px;
  }
  .rubric-card ul.tiers li {
    padding: 2px 0; display: flex; align-items: baseline; gap: .5rem;
  }
  .rubric-card ul.tiers .tier-pts {
    font-weight: 600; font-variant-numeric: tabular-nums; min-width: 28px;
    text-align: right; color: var(--accent);
  }
  .rubric-card ul.tiers .tier-pts.zero { color: var(--muted); }

  .rubric-extra {
    display: grid; grid-template-columns: 1fr 1fr; gap: .75rem; margin-top: .75rem;
  }
  .rubric-extra .rubric-card h4 { margin-bottom: .5rem; }
  .rubric-extra ul { margin: 0; padding-left: 1.1rem; font-size: 12.5px; line-height: 1.55; }
  .rubric-extra .red-card { border-color: #fecaca; background: #fef2f2; }
  .rubric-extra .red-card h4 { color: #991b1b; }

  @media (max-width: 900px) {
    .kpi-strip { grid-template-columns: repeat(2, 1fr); }
    .charts { grid-template-columns: 1fr; }
    .rubric-grid { grid-template-columns: repeat(2, 1fr); }
    .rubric-extra { grid-template-columns: 1fr; }
    td.title-cell { max-width: 200px; }
  }
</style></head>
<body>
<div class="wrap">

<header>
  <h1>BizBuySell Acquisition Targets</h1>
  <div class="sub"><a href="#rubric" style="color:var(--accent);text-decoration:none">Rubric v2</a> · ${records.length} listings · OK/TX/AR scrape + memo additions · generated ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>
</header>

<div class="kpi-strip">
  <div class="kpi"><div class="label">Listings</div><div class="value">${records.length}</div></div>
  <div class="kpi"><div class="label">Top score</div><div class="value">${records[0].score}</div></div>
  <div class="kpi"><div class="label">With asking price</div><div class="value">${withAsk}</div></div>
  <div class="kpi"><div class="label">With cash flow</div><div class="value">${withCF}</div></div>
  <div class="kpi"><div class="label">Memo-verified</div><div class="value">${records.filter((r) => r.isMemo).length}</div></div>
</div>

<h2>Top 30 ranked<span class="count">by rubric v2 score</span></h2>

<div class="toolbar">
  <input id="searchInput" placeholder="Filter by title, location, flag…"/>
  <select id="stateFilter">
    <option value="">All states</option>
    ${stateLabels.sort().map((s) => `<option value="${s}">${s}</option>`).join('')}
  </select>
  <select id="industryFilter">
    <option value="">All industries</option>
    ${indLabels.sort().map((i) => `<option value="${i}">${i}</option>`).join('')}
  </select>
  <label><input type="checkbox" id="memoOnly"/> memo-verified only</label>
  <span class="count-live" id="countLive">showing 30 of ${records.length}</span>
</div>

<div class="table-wrap">
<table id="topTable">
<thead><tr>
  <th data-sort="rank">#</th>
  <th data-sort="score" class="sorted">score</th>
  <th data-sort="industry">industry</th>
  <th data-sort="state">state</th>
  <th data-sort="cf" class="num">cash flow</th>
  <th data-sort="ask" class="num">asking</th>
  <th data-sort="mult" class="num">SDE mult</th>
  <th data-sort="marg" class="num">margin</th>
  <th data-sort="loc">location</th>
  <th data-sort="title">title</th>
  <th>flags</th>
</tr></thead>
<tbody>
${top30.map((r, i) => renderRow(r, i)).join('\n')}
</tbody></table>
</div>

<h2>Breakdowns</h2>
<div class="charts">
  <div class="chart-card"><h3>Score distribution</h3><canvas id="histChart"></canvas></div>
  <div class="chart-card"><h3>By state</h3><canvas id="stateChart"></canvas></div>
  <div class="chart-card"><h3>By industry</h3><canvas id="indChart"></canvas></div>
</div>

<h2 id="rubric">Scoring rubric v2<span class="count">100 pts across 8 categories · disqualifiers + soft red flags</span></h2>

<div class="rubric-grid">
  <div class="rubric-card">
    <h4>1. Scheduling / route density<span class="pts">20</span></h4>
    <p class="why">Routes, dispatch, maintenance agreements — gives AI something to optimize.</p>
    <ul class="tiers">
      <li><span class="tier-pts">+20</span> explicit routes, dispatch, agreements, CRM in place</li>
      <li><span class="tier-pts">+12</span> industry implies it (HVAC, pest, cleaning, plumbing)</li>
      <li><span class="tier-pts">+6</span> generic service business, no scheduling signal</li>
      <li><span class="tier-pts zero">+0</span> non-dispatched (retail, e-com, manufacturing)</li>
    </ul>
  </div>

  <div class="rubric-card">
    <h4>2. Owner workload AI can replace<span class="pts">18</span></h4>
    <p class="why">Does the owner answer phones, quote, schedule, chase invoices?</p>
    <ul class="tiers">
      <li><span class="tier-pts">+18</span> owner handles CSR/quoting/scheduling, &lt;10 employees</li>
      <li><span class="tier-pts">+10</span> small staff (&lt;10) inferred</li>
      <li><span class="tier-pts">+5</span> 10–25 staff with some admin already</li>
      <li><span class="tier-pts zero">+0</span> 25+ employees with existing dispatch</li>
    </ul>
  </div>

  <div class="rubric-card">
    <h4>3. Recurring / contract revenue<span class="pts">15</span></h4>
    <p class="why">Predictable dispatch = AI ROI + transferable enterprise value.</p>
    <ul class="tiers">
      <li><span class="tier-pts">+15</span> explicit recurring %, contracts, memberships, $/mo</li>
      <li><span class="tier-pts">+8</span> industry implies recurrence (pest, cleaning, HVAC)</li>
      <li><span class="tier-pts zero">+0</span> one-off transactional or project-based</li>
    </ul>
  </div>

  <div class="rubric-card">
    <h4>4. Size fit for side-income<span class="pts">10</span></h4>
    <p class="why">SBA-financeable, four-person team can start part-time.</p>
    <ul class="tiers">
      <li><span class="tier-pts">+10</span> SDE $100K–$400K, ask $150K–$1.5M, ≤15 emp</li>
      <li><span class="tier-pts">+5</span> SDE $400K–$750K or ask up to $2M</li>
      <li><span class="tier-pts zero">+0</span> SDE &lt;$75K, &gt;$1M, or ask &gt;$3M</li>
    </ul>
  </div>

  <div class="rubric-card">
    <h4>5. Price sanity vs regional multiple<span class="pts">8</span></h4>
    <p class="why">2025 BizBuySell medians: OKC 2.55x · Tulsa 2.34x · DFW 2.54x · Wichita 2.66x.</p>
    <ul class="tiers">
      <li><span class="tier-pts">+8</span> ask/SDE ≤ regional ceiling (OK 3.0x, DFW 2.85x)</li>
      <li><span class="tier-pts">+4</span> 1–20% over ceiling (negotiable)</li>
      <li><span class="tier-pts zero">+0</span> &gt;20% over, or ask/SDE missing</li>
    </ul>
  </div>

  <div class="rubric-card">
    <h4>6. Margin headroom vs benchmark<span class="pts">12</span></h4>
    <p class="why">Industry medians: pest 34% · cleaning 30% · landscaping 28% · HVAC/plumbing/electrical 22%.</p>
    <ul class="tiers">
      <li><span class="tier-pts">+12</span> SDE/Rev within healthy band (bench −5 to +15)</li>
      <li><span class="tier-pts">+6</span> within ±5 pts of band edge</li>
      <li><span class="tier-pts zero">+0</span> &lt;5% (constrained) or &gt;60% (inflated by owner labor)</li>
    </ul>
  </div>

  <div class="rubric-card">
    <h4>7. Absentee / manager-ready<span class="pts">10</span></h4>
    <p class="why">Owner-light = part-time-runnable from day one.</p>
    <ul class="tiers">
      <li><span class="tier-pts">+10</span> absentee, semi-absentee, manager in place, 1099 labor, home-based</li>
      <li><span class="tier-pts">+5</span> seller willing to stay / train / transition</li>
      <li><span class="tier-pts zero">+0</span> owner-critical, face-of-business, no qualifier path</li>
    </ul>
  </div>

  <div class="rubric-card">
    <h4>8. License transferability<span class="pts">7</span></h4>
    <p class="why">OK/TX regulate plumbing, HVAC, electrical, pesticide work. Buyer must hold it or hire a qualifier.</p>
    <ul class="tiers">
      <li><span class="tier-pts">+7</span> unregulated industry OR seller transitions license OR licensed lead tech stays</li>
      <li><span class="tier-pts">+3</span> regulated, generic transition support, no explicit qualifier plan</li>
      <li><span class="tier-pts zero">+0</span> regulated, no qualifier path disclosed</li>
    </ul>
  </div>
</div>

<div class="rubric-extra">
  <div class="rubric-card red-card">
    <h4>Hard disqualifiers (score = 0)</h4>
    <ul>
      <li>Restaurant, café, food service, medical, dental, legal — any licensed-professional where no qualifier path exists</li>
      <li>Franchise resale (royalty + territorial drag erases AI margin gains)</li>
      <li>Asking price &gt; $3M, or SDE &lt; $50K</li>
      <li>Start-up or pre-revenue</li>
      <li><b>Note:</b> "Contact for price" listings are <i>deferred</i>, not DQ'd — surfaced separately</li>
    </ul>
  </div>
  <div class="rubric-card">
    <h4>Soft red flags <span class="pts" style="background:#dc2626">−5 ea</span></h4>
    <ul>
      <li><b>Customer concentration</b> — "top customer," "single account represents X%"</li>
      <li><b>Technician-dependent</b> — "lead tech with us X years," "key employee"</li>
      <li><b>Owner-as-face</b> — "long-standing personal relationships," "owner's reputation"</li>
      <li><b>Non-transferable license</b> — "master plumber owner" with no qualifier path</li>
      <li><b>Inflated SDE</b> — &gt;60% SDE/revenue, usually owner-labor add-back</li>
      <li><b>Deferred capex</b> — "fleet due for replacement," "equipment end of life"</li>
    </ul>
  </div>
</div>

</div>

<script>
  // Chart.js
  const chartBase = {
    plugins: { legend: { display: false } },
    scales: { y: { beginAtZero: true, grid: { color: '#f1f5f9' } }, x: { grid: { display: false } } },
    maintainAspectRatio: false,
  };
  new Chart(document.getElementById('histChart'), {
    type: 'bar',
    data: { labels: ${JSON.stringify(binLabels)}, datasets: [{ label: 'listings', data: ${JSON.stringify(binValues)}, backgroundColor: '#4a7fd1', borderRadius: 3 }] },
    options: chartBase,
  });
  new Chart(document.getElementById('stateChart'), {
    type: 'bar',
    data: { labels: ${JSON.stringify(stateLabels)}, datasets: [{ label: 'listings', data: ${JSON.stringify(stateCounts)}, backgroundColor: '#16a34a', borderRadius: 3 }] },
    options: chartBase,
  });
  new Chart(document.getElementById('indChart'), {
    type: 'bar',
    data: {
      labels: ${JSON.stringify(indLabels)},
      datasets: [
        { label: 'count', data: ${JSON.stringify(indCounts)}, backgroundColor: '#16a34a', yAxisID: 'y', borderRadius: 3 },
        { label: 'avg score', data: ${JSON.stringify(indAvg)}, backgroundColor: '#d97706', yAxisID: 'y1', borderRadius: 3 },
      ]
    },
    options: {
      plugins: { legend: { display: true, position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } } },
      scales: {
        y: { beginAtZero: true, position: 'left', grid: { color: '#f1f5f9' }, ticks: { font: { size: 11 } } },
        y1: { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false }, ticks: { font: { size: 11 } } },
        x: { grid: { display: false }, ticks: { font: { size: 10 } } },
      },
      maintainAspectRatio: false,
    }
  });

  // Filtering
  const table = document.getElementById('topTable');
  const tbody = table.querySelector('tbody');
  const allRows = Array.from(tbody.querySelectorAll('tr'));
  const $search = document.getElementById('searchInput');
  const $state = document.getElementById('stateFilter');
  const $ind = document.getElementById('industryFilter');
  const $memo = document.getElementById('memoOnly');
  const $count = document.getElementById('countLive');
  const TOTAL = ${records.length};

  function applyFilter() {
    const q = $search.value.toLowerCase().trim();
    const st = $state.value;
    const ind = $ind.value;
    const memo = $memo.checked;
    let shown = 0;
    for (const tr of allRows) {
      const text = tr.innerText.toLowerCase();
      let ok = true;
      if (q && !text.includes(q)) ok = false;
      if (st && tr.dataset.state !== st) ok = false;
      if (ind && tr.dataset.industry !== ind) ok = false;
      if (memo && tr.dataset.memo !== '1') ok = false;
      tr.style.display = ok ? '' : 'none';
      if (ok) shown++;
    }
    $count.textContent = 'showing ' + shown + ' of ' + TOTAL;
  }
  [$search, $state, $ind, $memo].forEach((el) => el.addEventListener('input', applyFilter));

  // Sort
  const ths = table.querySelectorAll('th[data-sort]');
  ths.forEach((th) => {
    let asc = false;
    th.addEventListener('click', () => {
      ths.forEach((x) => x.classList.remove('sorted', 'asc'));
      th.classList.add('sorted');
      if (asc) th.classList.add('asc');
      const idx = Array.from(th.parentElement.children).indexOf(th);
      const trs = Array.from(tbody.querySelectorAll('tr'));
      trs.sort((a, b) => {
        const av = a.children[idx].innerText;
        const bv = b.children[idx].innerText;
        const an = parseFloat(av.replace(/[^-\\d.]/g, ''));
        const bn = parseFloat(bv.replace(/[^-\\d.]/g, ''));
        if (!isNaN(an) && !isNaN(bn)) return asc ? an - bn : bn - an;
        return asc ? av.localeCompare(bv) : bv.localeCompare(av);
      });
      asc = !asc;
      trs.forEach((tr) => tbody.appendChild(tr));
      // renumber
      tbody.querySelectorAll('tr').forEach((tr, i) => { tr.children[0].textContent = String(i + 1); });
    });
  });
</script>
</body></html>`;

fs.writeFileSync(OUT_HTML, html);
fs.writeFileSync(OUT_INDEX, html);
console.log(`wrote ${path.relative(process.cwd(), OUT_MD)}`);
console.log(`wrote ${path.relative(process.cwd(), OUT_HTML)}`);
console.log(`wrote ${path.relative(process.cwd(), OUT_INDEX)}`);
