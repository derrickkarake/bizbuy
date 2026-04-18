/**
 * Universal re-scorer: re-runs the scoring rubric on every row in the
 * CSV, using detail JSON when available, card-level data otherwise.
 * Used when the scoring rubric changes (e.g., proximity added).
 */
import fs from 'fs';
import path from 'path';
import { scoreListing } from '../analysis/score';
import type { ListingDetail } from '../scrapers/listing';
import type { CardSummary } from '../scrapers/search';

const CSV_PATH = path.resolve(__dirname, '../data/shortlist-v2.csv');
const DETAIL_DIR = path.resolve(__dirname, '../data/raw/detail');

function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = []; let field = ''; let inQuotes = false;
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

function csvEscape(s: string | number | null | undefined): string {
  if (s === null || s === undefined || s === '') return '';
  const str = String(s);
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

const text = fs.readFileSync(CSV_PATH, 'utf8');
const csvRows = parseCSV(text);
const header = csvRows[0];
const h = Object.fromEntries(header.map((k, i) => [k, i]));

const detailFiles = new Set(
  fs.existsSync(DETAIL_DIR)
    ? fs.readdirSync(DETAIL_DIR).filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', ''))
    : []
);

const outRows: string[][] = [header];
let changed = 0;

for (const r of csvRows.slice(1)) {
  if (!r[h['url']] || !r[h['listing_id']]) continue;
  const id = r[h['listing_id']];
  const industry = r[h['industry']];
  const state = r[h['state']];

  let detail: ListingDetail | null = null;
  if (detailFiles.has(id)) {
    detail = JSON.parse(fs.readFileSync(path.join(DETAIL_DIR, `${id}.json`), 'utf8'));
  }

  const card: CardSummary = {
    listingId: id,
    url: r[h['url']],
    title: detail?.title ?? r[h['title']] ?? null,
    location: detail?.location ?? r[h['location']] ?? null,
    askingPrice: detail?.askingPrice ?? (r[h['asking_price']] ? Number(r[h['asking_price']]) : null),
    cashFlow: detail?.cashFlowSde ?? (r[h['cash_flow_sde']] ? Number(r[h['cash_flow_sde']]) : null),
    descriptionSnippet: null,
    sourceUrl: r[h['url']],
  };

  const scored = scoreListing(card, detail, industry, state);

  // Preserve memo flags; add detail-scraped flag if we have a detail JSON
  const prior = (r[h['flags_v2']] ?? '').split('|').filter(Boolean);
  const memoFlags = prior.filter((f: string) => /memo-sourced|memo-verified|delisted-404/.test(f));
  const newFlags = [...new Set([...scored.flags, ...memoFlags, ...(detail ? ['detail-scraped'] : [])])].join('|');

  // Honor manual delisted-404 flag — forces score to 0 regardless
  const isDelisted = newFlags.includes('delisted-404');
  const finalScore = isDelisted ? 0 : (scored.disqualified ? 0 : scored.score);
  const priorScore = Number(r[h['score_v2']] ?? 0);
  if (finalScore !== priorScore) changed++;

  const newRow = [
    String(finalScore),
    id,
    detail?.title ?? r[h['title']] ?? '',
    state,
    industry,
    String(detail?.askingPrice ?? r[h['asking_price']] ?? ''),
    String(detail?.cashFlowSde ?? r[h['cash_flow_sde']] ?? ''),
    String(detail?.grossRevenue ?? r[h['gross_revenue']] ?? ''),
    scored.sdeMultiple !== null ? scored.sdeMultiple.toFixed(2) : (r[h['sde_multiple']] ?? ''),
    scored.sdeMargin !== null ? scored.sdeMargin.toFixed(4) : (r[h['sde_margin']] ?? ''),
    String(detail?.employees ?? r[h['employees']] ?? ''),
    detail?.location ?? r[h['location']] ?? '',
    newFlags,
    r[h['url']],
  ];

  outRows.push(newRow);
}

outRows.sort((a, b) => {
  if (a === header) return -1;
  if (b === header) return 1;
  return Number(b[0]) - Number(a[0]);
});

const out = outRows.map((cols) => cols.map(csvEscape).join(',')).join('\n') + '\n';
fs.writeFileSync(CSV_PATH, out);

console.log(`rescored ${outRows.length - 1} rows, ${changed} scores changed`);
console.log(`top 5 states represented (by count of score>=60):`);
const strong = outRows.slice(1).filter((r) => Number(r[0]) >= 60);
const byState = new Map<string, number>();
for (const r of strong) byState.set(r[3], (byState.get(r[3]) ?? 0) + 1);
const sorted = [...byState.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
for (const [st, n] of sorted) console.log(`  ${st}: ${n}`);
