/**
 * Detail-only pass with human-like pacing.
 * - fresh profile dir (.browser-profile-fresh) — avoids any Akamai flag on the old profile
 * - warms session by visiting homepage, then a category page, BEFORE any detail fetch
 * - randomized delays (5–12 s), random scrolls, random mouse wiggles
 * - cap: top 30 from shortlist-v2.csv
 * - saves each detail JSON to data/listings/<id>.json as it goes (resumable)
 */
import fs from 'fs';
import path from 'path';
import { chromium, BrowserContext, Page } from '@playwright/test';
import { scrapeListing } from '../scrapers/listing';

const PROFILE = path.resolve(__dirname, '../.browser-profile-fresh');
const CSV = path.resolve(__dirname, '../data/shortlist-v2.csv');
const LISTINGS_DIR = path.resolve(__dirname, '../data/listings');
const TOP_N = 30;

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
      else if (c === '\r') {}
      else field += c;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}
function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function humanPause(label = '') {
  const ms = Math.round(rand(5500, 12000));
  if (label) console.log(`  · pausing ${Math.round(ms / 1000)}s ${label}`);
  await sleep(ms);
}

async function humanInteract(page: Page) {
  // random scroll
  const scrolls = Math.floor(rand(1, 4));
  for (let i = 0; i < scrolls; i++) {
    const y = Math.round(rand(200, 900));
    await page.mouse.wheel(0, y);
    await sleep(rand(400, 1400));
  }
  // mouse wiggle
  await page.mouse.move(rand(100, 1200), rand(100, 800), { steps: 10 });
  await sleep(rand(200, 800));
}

(async () => {
  fs.mkdirSync(LISTINGS_DIR, { recursive: true });

  // load top N URLs from v2 CSV
  const rows = parseCSV(fs.readFileSync(CSV, 'utf8'));
  const h = Object.fromEntries(rows[0].map((c, i) => [c, i]));
  const targets = rows.slice(1)
    .filter((r) => r[h['url']])
    .slice(0, TOP_N)
    .map((r) => ({
      listingId: r[h['listing_id']],
      url: r[h['url']],
      title: r[h['title']],
    }));

  console.log(`[detail-pass] fresh profile at ${PROFILE}`);
  console.log(`[detail-pass] ${targets.length} detail targets\n`);

  const context: BrowserContext = await chromium.launchPersistentContext(PROFILE, {
    headless: false,
    channel: 'chrome',
    viewport: { width: 1440, height: 900 },
    locale: 'en-US',
    timezoneId: 'America/Los_Angeles',
    args: ['--disable-blink-features=AutomationControlled'],
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  const page = context.pages()[0] ?? (await context.newPage());

  // ---- warm session: homepage -> a category -> first detail ----
  console.log('[warm] homepage…');
  await page.goto('https://www.bizbuysell.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  if (/access denied/i.test(await page.title())) {
    console.error('[warm] BLOCKED on homepage. Aborting.');
    await context.close();
    process.exit(1);
  }
  await humanInteract(page);
  await humanPause('after homepage');

  console.log('[warm] texas/hvac search page…');
  await page.goto('https://www.bizbuysell.com/texas/hvac-businesses-for-sale/', {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
    referer: 'https://www.bizbuysell.com/',
  });
  if (/access denied/i.test(await page.title())) {
    console.error('[warm] BLOCKED on search page. Aborting.');
    await context.close();
    process.exit(1);
  }
  await humanInteract(page);
  await humanPause('after search page');

  // ---- detail fetches ----
  let ok = 0;
  let fail = 0;
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    const outFile = path.join(LISTINGS_DIR, `${t.listingId}.json`);
    if (fs.existsSync(outFile)) {
      console.log(`[${i + 1}/${targets.length}] ${t.listingId} already fetched, skipping`);
      continue;
    }
    process.stdout.write(`[${i + 1}/${targets.length}] ${t.listingId} — ${t.title.slice(0, 50)} … `);
    try {
      const detail = await scrapeListing(context, t.url);
      if (detail) {
        fs.writeFileSync(outFile, JSON.stringify(detail, null, 2));
        ok++;
        console.log(`ok  ask=${detail.askingPrice ?? '—'} sde=${detail.cashFlowSde ?? '—'}`);
      } else {
        fail++;
        console.log('no detail (null)');
      }
    } catch (e) {
      fail++;
      console.log(`ERR ${(e as Error).message.split('\n')[0].slice(0, 80)}`);
    }

    await humanInteract(page);
    await humanPause();
  }

  console.log(`\n[detail-pass] done. ok=${ok} fail=${fail}`);
  await context.close();
})();
