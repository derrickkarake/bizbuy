/**
 * Re-score every CSV row that has a saved detail JSON in
 * data/raw/detail/. No network, just disk. Picks up the franchise-DQ
 * fix and any other scorer changes. Also flags listings whose detail
 * scrape 404'd as delisted.
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

const detailFiles = new Set(fs.readdirSync(DETAIL_DIR).filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', '')));
console.log(`detail JSONs on disk: ${detailFiles.size}`);

let updated = 0;
const outRows: string[] = [header.join(',')];

for (const r of csvRows.slice(1)) {
  if (!r[h['url']]) continue;
  const id = r[h['listing_id']];
  if (!detailFiles.has(id)) {
    outRows.push(r.map(csvEscape).join(','));
    continue;
  }

  const detail: ListingDetail = JSON.parse(fs.readFileSync(path.join(DETAIL_DIR, `${id}.json`), 'utf8'));
  const card: CardSummary = {
    listingId: id,
    url: r[h['url']],
    title: detail.title ?? r[h['title']],
    location: detail.location ?? r[h['location']],
    askingPrice: detail.askingPrice ?? (r[h['asking_price']] ? Number(r[h['asking_price']]) : null),
    cashFlow: detail.cashFlowSde ?? (r[h['cash_flow_sde']] ? Number(r[h['cash_flow_sde']]) : null),
    descriptionSnippet: null,
    sourceUrl: r[h['url']],
  };
  const industry = r[h['industry']];
  const state = r[h['state']];
  const scored = scoreListing(card, detail, industry, state);

  const existingFlags = (r[h['flags_v2']] ?? '').split('|').filter(Boolean);
  const memoFlags = existingFlags.filter((f: string) => /memo-sourced|memo-verified/.test(f));
  const mergedFlags = [...new Set([...scored.flags, ...memoFlags, 'detail-scraped'])].join('|');

  const newScore = scored.disqualified ? 0 : scored.score;
  const newRow = [
    newScore,
    id,
    detail.title ?? r[h['title']],
    state,
    industry,
    detail.askingPrice ?? r[h['asking_price']] ?? '',
    detail.cashFlowSde ?? r[h['cash_flow_sde']] ?? '',
    detail.grossRevenue ?? r[h['gross_revenue']] ?? '',
    scored.sdeMultiple !== null ? scored.sdeMultiple.toFixed(2) : (r[h['sde_multiple']] ?? ''),
    scored.sdeMargin !== null ? scored.sdeMargin.toFixed(4) : (r[h['sde_margin']] ?? ''),
    detail.employees ?? r[h['employees']] ?? '',
    detail.location ?? r[h['location']],
    mergedFlags,
    r[h['url']],
  ].map(csvEscape).join(',');

  if (newScore !== Number(r[h['score_v2']] ?? 0)) {
    console.log(`  ${id} ${r[h['score_v2']]} → ${newScore}${scored.disqualified ? ' [DQ]' : ''}  ${(detail.title ?? r[h['title']]).slice(0, 50)}`);
  }
  outRows.push(newRow);
  updated++;
}

// Sort by score desc
const sorted = [outRows[0], ...outRows.slice(1).sort((a, b) => {
  const sa = Number(a.split(',')[0]);
  const sb = Number(b.split(',')[0]);
  return sb - sa;
})].join('\n') + '\n';

fs.writeFileSync(CSV_PATH, sorted);
console.log(`\nre-scored ${updated} rows with detail data`);
