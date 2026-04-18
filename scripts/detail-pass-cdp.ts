/**
 * Detail-page pass via CDP-attached Chrome. Picks:
 *  - The 10 memo listings (verify / refresh seller-provided numbers)
 *  - Top non-memo rows missing asking_price (unlock real score)
 *
 * For each, scrapes the detail page, re-scores with richer data, and
 * rewrites the matching row in data/shortlist-v2.csv in place (sorted
 * by score). Raw detail JSON saved under data/raw/detail/.
 */
import fs from 'fs';
import path from 'path';
import { chromium, BrowserContext } from '@playwright/test';
import { scrapeListing, ListingDetail } from '../scrapers/listing';
import { scoreListing } from '../analysis/score';
import type { CardSummary } from '../scrapers/search';

const CSV_PATH = path.resolve(__dirname, '../data/shortlist-v2.csv');
const RAW_DIR = path.resolve(__dirname, '../data/raw/detail');
const NAV_DELAY_MS = 6500;
const TARGET_NON_MEMO = 30;
const STATE_FILTER = new Set(['texas', 'oklahoma', 'arkansas']); // narrow to home ring

type Row = {
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

function rowToCsv(r: Row): string {
  return [
    r.score,
    r.id,
    r.title,
    r.state,
    r.industry,
    r.ask ?? '',
    r.cf ?? '',
    r.revenue ?? '',
    r.multiple !== null ? r.multiple.toFixed(2) : '',
    r.margin !== null ? r.margin.toFixed(4) : '',
    r.employees ?? '',
    r.location,
    r.flags,
    r.url,
  ].map(csvEscape).join(',');
}

async function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  fs.mkdirSync(RAW_DIR, { recursive: true });

  // --- load CSV ---
  const text = fs.readFileSync(CSV_PATH, 'utf8');
  const csvRows = parseCSV(text);
  const header = csvRows[0];
  const h = Object.fromEntries(header.map((k, i) => [k, i]));
  const rows: Row[] = csvRows.slice(1).filter((r) => r[h['url']]).map((r) => ({
    score: Number(r[h['score_v2']] ?? 0),
    id: r[h['listing_id']],
    title: r[h['title']],
    state: r[h['state']],
    industry: r[h['industry']],
    ask: r[h['asking_price']] ? Number(r[h['asking_price']]) : null,
    cf: r[h['cash_flow_sde']] ? Number(r[h['cash_flow_sde']]) : null,
    revenue: r[h['gross_revenue']] ? Number(r[h['gross_revenue']]) : null,
    multiple: r[h['sde_multiple']] ? Number(r[h['sde_multiple']]) : null,
    margin: r[h['sde_margin']] ? Number(r[h['sde_margin']]) : null,
    employees: r[h['employees']] ? Number(r[h['employees']]) : null,
    location: r[h['location']],
    flags: r[h['flags_v2']] ?? '',
    url: r[h['url']],
  }));

  // --- pick targets ---
  // Skip rows that already have detail-scraped or delisted flag — we have them.
  const nonMemoCandidates = rows
    .filter((r) => !/memo-sourced|memo-verified/.test(r.flags))
    .filter((r) => !/detail-scraped|delisted-404/.test(r.flags))
    .filter((r) => r.ask === null)
    .filter((r) => STATE_FILTER.has(r.state))
    .sort((a, b) => b.score - a.score)
    .slice(0, TARGET_NON_MEMO);

  const targets = nonMemoCandidates;
  console.log(`targets: ${nonMemoCandidates.length} TX/OK/AR rows missing asking price`);

  // --- connect CDP ---
  console.log('connecting to ws://localhost:9222...');
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const ctx: BrowserContext = browser.contexts()[0];

  const updates = new Map<string, Row>();

  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    console.log(`\n[${i + 1}/${targets.length}] ${t.id} — ${t.title.slice(0, 60)}`);
    let detail: ListingDetail | null = null;
    try {
      detail = await scrapeListing(ctx, t.url);
    } catch (e) {
      console.warn(`  scrape error: ${(e as Error).message.split('\n')[0]}`);
    }
    if (!detail) {
      console.log(`  -> no detail (likely blocked or 404)`);
      await sleep(NAV_DELAY_MS);
      continue;
    }

    // save raw
    fs.writeFileSync(path.join(RAW_DIR, `${t.id}.json`), JSON.stringify(detail, null, 2));

    // synthesize a card for scoring
    const card: CardSummary = {
      listingId: t.id,
      url: t.url,
      title: detail.title ?? t.title,
      location: detail.location ?? t.location,
      askingPrice: detail.askingPrice ?? t.ask,
      cashFlow: detail.cashFlowSde ?? t.cf,
      descriptionSnippet: null,
      sourceUrl: t.url,
    };
    const scored = scoreListing(card, detail, t.industry, t.state);
    const existingFlags = t.flags.split('|').filter(Boolean);
    const detailFlag = 'detail-scraped';
    const memoFlags = existingFlags.filter((f) => /memo-sourced|memo-verified/.test(f));
    const mergedFlags = [...new Set([...scored.flags, ...memoFlags, detailFlag])].join('|');

    const merged: Row = {
      ...t,
      score: scored.disqualified ? 0 : scored.score,
      title: detail.title ?? t.title,
      ask: detail.askingPrice ?? t.ask,
      cf: detail.cashFlowSde ?? t.cf,
      revenue: detail.grossRevenue ?? t.revenue,
      multiple: scored.sdeMultiple ?? t.multiple,
      margin: scored.sdeMargin ?? t.margin,
      employees: detail.employees ?? t.employees,
      location: detail.location ?? t.location,
      flags: mergedFlags,
    };
    updates.set(t.id, merged);
    console.log(`  -> ask=${detail.askingPrice ?? '—'} sde=${detail.cashFlowSde ?? '—'} rev=${detail.grossRevenue ?? '—'} emp=${detail.employees ?? '—'} score: ${t.score} → ${merged.score}`);

    await sleep(NAV_DELAY_MS);
  }

  await browser.close();

  // --- merge and rewrite CSV ---
  const finalRows = rows.map((r) => updates.get(r.id) ?? r);
  finalRows.sort((a, b) => b.score - a.score);
  const out = [header.join(','), ...finalRows.map(rowToCsv)].join('\n') + '\n';
  fs.writeFileSync(CSV_PATH, out);

  console.log(`\nupdated ${updates.size} rows, rewrote ${path.relative(process.cwd(), CSV_PATH)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
