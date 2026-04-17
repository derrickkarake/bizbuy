/**
 * Rescore existing shortlist.csv with rubric v2.
 * We only have card-level data (no description snippet, no detail), so
 * v2 keyword matches fire from titles + location only. Still directionally
 * useful, and better than v1 because it now applies license transferability,
 * price sanity, industry-specific margin, and red-flag signals.
 */
import fs from 'fs';
import path from 'path';
import { scoreListing } from '../analysis/score';
import type { CardSummary } from '../scrapers/search';

const SRC = path.resolve(__dirname, '../data/shortlist.csv');
const DST = path.resolve(__dirname, '../data/shortlist-v2.csv');

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

function toCSVRow(fields: Array<string | number | null>): string {
  return fields.map((f) => {
    if (f === null || f === undefined) return '';
    const s = String(f).replace(/"/g, '""');
    return /[",\n]/.test(s) ? `"${s}"` : s;
  }).join(',');
}

const text = fs.readFileSync(SRC, 'utf8');
const rows = parseCSV(text);
const header = rows[0];
const idx = Object.fromEntries(header.map((h, i) => [h, i]));

const rescored: Array<{ score: number; row: string[]; card: any; multiple: number | null; margin: number | null; flags: string[] }> = [];
for (let i = 1; i < rows.length; i++) {
  const r = rows[i];
  if (!r[idx['url']]) continue;
  const card: CardSummary = {
    listingId: r[idx['listing_id']] || null,
    url: r[idx['url']],
    title: r[idx['title']] || null,
    location: r[idx['location']] || null,
    askingPrice: r[idx['asking_price']] ? Number(r[idx['asking_price']]) : null,
    cashFlow: r[idx['cash_flow_sde']] ? Number(r[idx['cash_flow_sde']]) : null,
    descriptionSnippet: null,
    sourceUrl: r[idx['url']],
  };
  const state = r[idx['state']];
  const industry = r[idx['industry']];
  const s = scoreListing(card, null, industry, state);
  rescored.push({ score: s.score, row: r, card, multiple: s.sdeMultiple, margin: s.sdeMargin, flags: s.flags });
}

rescored.sort((a, b) => b.score - a.score);

const outHeader = [
  'score_v2', 'listing_id', 'title', 'state', 'industry',
  'asking_price', 'cash_flow_sde', 'gross_revenue',
  'sde_multiple', 'sde_margin', 'employees', 'location', 'flags_v2', 'url',
];
const outRows = [toCSVRow(outHeader)];
for (const r of rescored) {
  const row = r.row;
  outRows.push(toCSVRow([
    r.score,
    row[idx['listing_id']],
    row[idx['title']],
    row[idx['state']],
    row[idx['industry']],
    row[idx['asking_price']] || null,
    row[idx['cash_flow_sde']] || null,
    row[idx['gross_revenue']] || null,
    r.multiple !== null ? r.multiple.toFixed(2) : null,
    r.margin !== null ? r.margin.toFixed(3) : null,
    row[idx['employees']] || null,
    row[idx['location']],
    r.flags.join('|'),
    row[idx['url']],
  ]));
}
fs.writeFileSync(DST, outRows.join('\n'));

console.log(`rescored ${rescored.length} listings -> ${path.relative(process.cwd(), DST)}`);
console.log('\n=== Top 15 (v2) ===');
rescored.slice(0, 15).forEach((r, i) => {
  const title = r.row[idx['title']].slice(0, 55);
  const ind = r.row[idx['industry']];
  const st = r.row[idx['state']];
  const cf = r.row[idx['cash_flow_sde']] ? `$${Number(r.row[idx['cash_flow_sde']]).toLocaleString()}` : '—';
  console.log(`  ${String(i+1).padStart(2)}. [${String(r.score).padStart(2)}] ${st}/${ind.padEnd(24)} cf=${cf.padStart(10)}  ${title}`);
});
