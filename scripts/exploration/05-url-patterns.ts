/**
 * Probes BizBuySell URL patterns directly instead of clicking the UI.
 * For each candidate URL, records HTTP status, final URL (after redirects),
 * title, and whether listing cards are present. This tells us the canonical
 * path scheme for industry + state slicing, which beats clicking filters.
 */
import fs from 'fs';
import path from 'path';
import { launchSession } from '../../scrapers/session';

const OUT_DIR = path.resolve(__dirname, 'out');
fs.mkdirSync(OUT_DIR, { recursive: true });

const CANDIDATES = [
  'https://www.bizbuysell.com/businesses-for-sale/',
  'https://www.bizbuysell.com/service-businesses-for-sale/',
  'https://www.bizbuysell.com/plumbing-businesses-for-sale/',
  'https://www.bizbuysell.com/hvac-businesses-for-sale/',
  'https://www.bizbuysell.com/heating-cooling-businesses-for-sale/',
  'https://www.bizbuysell.com/electrical-businesses-for-sale/',
  'https://www.bizbuysell.com/landscaping-businesses-for-sale/',
  'https://www.bizbuysell.com/pest-control-businesses-for-sale/',
  'https://www.bizbuysell.com/cleaning-businesses-for-sale/',
  'https://www.bizbuysell.com/building-and-construction-businesses-for-sale/',
  'https://www.bizbuysell.com/texas-businesses-for-sale/',
  'https://www.bizbuysell.com/florida-businesses-for-sale/',
  'https://www.bizbuysell.com/texas/plumbing-businesses-for-sale/',
  'https://www.bizbuysell.com/texas/hvac-businesses-for-sale/',
];

(async () => {
  const context = await launchSession({ headless: false });
  const page = context.pages()[0] ?? (await context.newPage());

  const results: Array<Record<string, unknown>> = [];
  for (const url of CANDIDATES) {
    try {
      const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(1200);
      const title = await page.title();
      const cardCount = await page.locator('[class*="listing" i], article, .result').count();
      const h1 = await page.locator('h1').first().innerText().catch(() => '');
      results.push({
        url,
        status: resp?.status() ?? null,
        finalUrl: page.url(),
        title: title.slice(0, 100),
        h1: h1.slice(0, 100),
        approxCards: cardCount,
      });
      console.log(`${resp?.status()} ${url} -> ${page.url()} | ${title.slice(0, 60)}`);
    } catch (e) {
      results.push({ url, error: (e as Error).message });
      console.log(`ERR ${url}: ${(e as Error).message}`);
    }
  }
  fs.writeFileSync(path.join(OUT_DIR, '05-url-patterns.json'), JSON.stringify(results, null, 2));
  await context.close();
})();
