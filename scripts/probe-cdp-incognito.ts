/**
 * Connect to a user-launched Chrome incognito window over CDP and probe
 * BizBuySell. The user runs Chrome with:
 *
 *   /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
 *     --remote-debugging-port=9222 --incognito \
 *     --user-data-dir=/tmp/chrome-debug-bizbuy
 *
 * Then this probe navigates 3 URLs and reports status + title. Writes
 * raw HTML to data/raw/cdp-probe/ for offline inspection if any pass.
 */
import { chromium } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const TEST_URLS = [
  'https://www.bizbuysell.com/businesses-for-sale/',
  'https://www.bizbuysell.com/oklahoma/hvac-businesses-for-sale/',
  'https://www.bizbuysell.com/business-opportunity/residential-hvac-serving-oklahoma-city/2455476/',
];

async function main() {
  const outDir = path.resolve(__dirname, '../data/raw/cdp-probe');
  fs.mkdirSync(outDir, { recursive: true });

  console.log('connecting to ws://localhost:9222...');
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const contexts = browser.contexts();
  console.log(`contexts: ${contexts.length}`);
  // Use the existing incognito context (the one Chrome launched with --incognito)
  const ctx = contexts[0];
  const page = ctx.pages()[0] ?? (await ctx.newPage());

  const results: any[] = [];

  for (const url of TEST_URLS) {
    console.log(`\n→ ${url}`);
    let status: number | null = null;
    let title = '';
    let blocked = false;
    let note = '';
    try {
      const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      status = resp?.status() ?? null;
      await page.waitForTimeout(1200);
      title = await page.title();
      const body = (await page.content()).slice(0, 400);
      if (/access denied/i.test(title) || /access denied/i.test(body)) blocked = true;
      if (status && status >= 400) blocked = true;

      // save raw HTML for inspection
      const slug = url.replace(/https?:\/\//, '').replace(/[^\w]+/g, '_').slice(0, 80);
      const html = await page.content();
      fs.writeFileSync(path.join(outDir, `${slug}.html`), html);
    } catch (e) {
      blocked = true;
      note = (e as Error).message.split('\n')[0];
    }

    const mark = blocked ? '❌' : '✅';
    console.log(`  ${mark} status=${status} title="${title.slice(0, 80)}"`);
    if (note) console.log(`     ${note}`);
    results.push({ url, status, title, blocked, note });

    await page.waitForTimeout(4000);
  }

  console.log('\n--- summary ---');
  const passed = results.filter((r) => !r.blocked).length;
  console.log(`${passed}/${results.length} passed`);

  await browser.close(); // detaches CDP; the user's Chrome window stays open
}

main().catch((e) => { console.error(e); process.exit(1); });
