/**
 * Extract broker contact info from detail pages via CDP.
 * Also saves raw HTML so future passes don't need to re-fetch.
 *
 * Output: data/brokers.json — keyed by listing_id.
 */
import fs from 'fs';
import path from 'path';
import { chromium, BrowserContext } from '@playwright/test';

const CSV_PATH = path.resolve(__dirname, '../data/shortlist-v2.csv');
const HTML_DIR = path.resolve(__dirname, '../data/raw/detail-html');
const OUT_PATH = path.resolve(__dirname, '../data/brokers.json');
const NAV_DELAY_MS = 7000;
const TARGET_COUNT = 30;

type Broker = {
  listingId: string;
  brokerName: string | null;
  brokerUrl: string | null;
  firmName: string | null;
  phone: string | null;
  fetchedAt: string;
  note?: string;
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

async function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  fs.mkdirSync(HTML_DIR, { recursive: true });

  const text = fs.readFileSync(CSV_PATH, 'utf8');
  const csv = parseCSV(text);
  const header = csv[0];
  const h = Object.fromEntries(header.map((k, i) => [k, i]));

  // Pick top TARGET_COUNT rows with real URLs, sorted by score desc.
  // Skip delisted-404 rows.
  const rows = csv.slice(1).filter((r) => r[h['url']]);
  rows.sort((a, b) => Number(b[h['score_v2']] ?? 0) - Number(a[h['score_v2']] ?? 0));
  const targets = rows
    .filter((r) => !(r[h['flags_v2']] ?? '').includes('delisted-404'))
    .slice(0, TARGET_COUNT);

  console.log(`connecting to ws://localhost:9222...`);
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const ctx: BrowserContext = browser.contexts()[0];
  const page = ctx.pages()[0] ?? (await ctx.newPage());

  // Load existing brokers.json if present
  const out: Record<string, Broker> = fs.existsSync(OUT_PATH)
    ? JSON.parse(fs.readFileSync(OUT_PATH, 'utf8'))
    : {};

  let blockedStreak = 0;

  for (let i = 0; i < targets.length; i++) {
    const r = targets[i];
    const id = r[h['listing_id']];
    const url = r[h['url']];
    const score = r[h['score_v2']];
    const title = r[h['title']].slice(0, 55);
    console.log(`\n[${i + 1}/${targets.length}] ${score} ${id} — ${title}`);

    if (out[id]) {
      console.log(`  already extracted, skipping`);
      continue;
    }

    let resp;
    try {
      resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    } catch (e) {
      console.warn(`  nav error: ${(e as Error).message.split('\n')[0]}`);
      blockedStreak++;
      if (blockedStreak >= 3) {
        console.warn(`  3 consecutive failures — Akamai likely re-throttled. Stopping.`);
        break;
      }
      await sleep(NAV_DELAY_MS);
      continue;
    }

    if (!resp || resp.status() >= 400) {
      console.warn(`  HTTP ${resp?.status() ?? 'n/a'}`);
      blockedStreak++;
      if (blockedStreak >= 3) {
        console.warn(`  3 consecutive failures — stopping.`);
        break;
      }
      await sleep(NAV_DELAY_MS);
      continue;
    }

    await page.waitForTimeout(800);
    const pageTitle = await page.title();
    if (/access denied/i.test(pageTitle)) {
      console.warn(`  Access Denied page.`);
      blockedStreak++;
      if (blockedStreak >= 3) break;
      await sleep(NAV_DELAY_MS);
      continue;
    }
    blockedStreak = 0;

    // Save raw HTML
    const htmlContent = await page.content();
    fs.writeFileSync(path.join(HTML_DIR, `${id}.html`), htmlContent);

    // Extract broker fields in the browser
    const broker = await page.evaluate(() => {
      const nameEl = document.querySelector('#ContactBrokerNameHyperLink') as HTMLAnchorElement | null;
      const firmEl = document.querySelector('.cmp-name') as HTMLElement | null;
      const telEl = document.querySelector('a[href^="tel:"]') as HTMLAnchorElement | null;
      return {
        brokerName: nameEl?.innerText?.trim() ?? null,
        brokerUrl: nameEl?.href ?? null,
        firmName: firmEl?.innerText?.trim() ?? null,
        phone: telEl?.href?.replace(/^tel:/, '') ?? null,
      };
    });

    out[id] = {
      listingId: id,
      ...broker,
      fetchedAt: new Date().toISOString(),
    };

    console.log(`  broker: ${broker.brokerName ?? '—'} · ${broker.firmName ?? '—'} · ${broker.phone ?? '—'}`);

    // Save incrementally so a mid-run block doesn't lose progress
    fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2));

    await sleep(NAV_DELAY_MS);
  }

  await browser.close();

  const withBroker = Object.values(out).filter((b) => b.brokerName).length;
  console.log(`\nextracted ${Object.keys(out).length} total, ${withBroker} with broker name`);
  console.log(`wrote ${path.relative(process.cwd(), OUT_PATH)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
