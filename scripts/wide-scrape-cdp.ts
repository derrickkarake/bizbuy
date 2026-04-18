/**
 * Wide scrape via CDP-attached incognito Chrome. Adds memo states
 * (KS, MA, CA, NY, OH, VA, FL) × 4 confirmed industry slugs. Card-level
 * data only (no detail pages — keeps us under Akamai's radar).
 *
 * Pre-req: Chrome incognito running on localhost:9222. Launch with:
 *   /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
 *     --remote-debugging-port=9222 --incognito \
 *     --user-data-dir=/tmp/chrome-debug-bizbuy
 *
 * Dedups against existing shortlist-v2.csv listing_ids. Scores new
 * cards using analysis/score.ts (card-only mode). Appends to CSV.
 */
import fs from 'fs';
import path from 'path';
import { chromium, BrowserContext } from '@playwright/test';
import { scrapeSearchPage, CardSummary } from '../scrapers/search';
import { scoreListing } from '../analysis/score';

const CSV_PATH = path.resolve(__dirname, '../data/shortlist-v2.csv');
const RAW_DIR = path.resolve(__dirname, '../data/raw/wide-scrape');

const STATES = ['california', 'new-york', 'ohio', 'virginia', 'florida'];
const INDUSTRIES = ['service', 'building-and-construction'];

const BASE = 'https://www.bizbuysell.com';
const NAV_DELAY_MS = 6500;

function readExistingIds(): Set<string> {
  const text = fs.readFileSync(CSV_PATH, 'utf8');
  const lines = text.split('\n').slice(1);
  const ids = new Set<string>();
  for (const line of lines) {
    const cols = line.split(',');
    if (cols[1]) ids.add(cols[1].replace(/"/g, '').trim());
  }
  return ids;
}

function csvEscape(s: string | number | null | undefined): string {
  if (s === null || s === undefined) return '';
  const str = String(s);
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

async function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  fs.mkdirSync(RAW_DIR, { recursive: true });

  console.log('connecting to ws://localhost:9222...');
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const ctx: BrowserContext = browser.contexts()[0];
  const page = ctx.pages()[0] ?? (await ctx.newPage());

  const knownIds = readExistingIds();
  console.log(`existing listings: ${knownIds.size}`);

  const newCards: Array<{ card: CardSummary; state: string; industry: string }> = [];
  const log: string[] = [];
  let pageCount = 0;

  for (const state of STATES) {
    for (const industry of INDUSTRIES) {
      const url = `${BASE}/${state}/${industry}-businesses-for-sale/`;
      pageCount++;
      console.log(`\n[${pageCount}/${STATES.length * INDUSTRIES.length}] ${url}`);

      let cards: CardSummary[] = [];
      try {
        cards = await scrapeSearchPage(ctx, url);
      } catch (e) {
        console.warn(`  fail: ${(e as Error).message.split('\n')[0]}`);
        log.push(`${state}/${industry}: FAIL`);
        await sleep(NAV_DELAY_MS);
        continue;
      }

      // save raw
      const slug = `${state}_${industry}`;
      fs.writeFileSync(path.join(RAW_DIR, `${slug}.json`), JSON.stringify(cards, null, 2));

      const fresh = cards.filter((c) => c.listingId && !knownIds.has(c.listingId));
      console.log(`  ${cards.length} cards, ${fresh.length} new`);
      log.push(`${state}/${industry}: ${cards.length} total, ${fresh.length} new`);

      for (const c of fresh) {
        newCards.push({ card: c, state, industry });
        if (c.listingId) knownIds.add(c.listingId);
      }

      await sleep(NAV_DELAY_MS);
    }
  }

  await browser.close();

  console.log(`\nscoring ${newCards.length} new listings...`);

  // Score and write
  const rows: string[] = [];
  for (const { card, state, industry } of newCards) {
    const scored = scoreListing(card, null, industry, state);
    if (scored.disqualified) continue;
    const flagsStr = scored.flags.join('|');
    const row = [
      scored.score,
      card.listingId,
      card.title ?? '',
      state,
      industry,
      card.askingPrice ?? '',
      card.cashFlow ?? '',
      '', // gross_revenue (not on card)
      scored.sdeMultiple !== null ? scored.sdeMultiple.toFixed(2) : '',
      scored.sdeMargin !== null ? scored.sdeMargin.toFixed(4) : '',
      '', // employees (not on card)
      card.location ?? '',
      flagsStr,
      card.url,
    ].map(csvEscape).join(',');
    rows.push(row);
  }

  if (rows.length > 0) {
    fs.appendFileSync(CSV_PATH, '\n' + rows.join('\n'));
    console.log(`appended ${rows.length} rows to ${path.relative(process.cwd(), CSV_PATH)}`);
  } else {
    console.log('no new rows to append');
  }

  fs.writeFileSync(path.join(RAW_DIR, '_run.log'), log.join('\n'));
  console.log(`\nlog saved to ${path.relative(process.cwd(), path.join(RAW_DIR, '_run.log'))}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
