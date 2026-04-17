/**
 * Two goals:
 *  (1) Parse the listing-card DOM on a category page so we know how to
 *      extract title, url, price, cash flow, location from each card.
 *  (2) Apply price + SDE filters via the UI and capture the resulting
 *      URL so we can decode the ?q=<base64> scheme.
 */
import fs from 'fs';
import path from 'path';
import { launchSession } from '../../scrapers/session';

const OUT_DIR = path.resolve(__dirname, 'out');
fs.mkdirSync(OUT_DIR, { recursive: true });

function b64decode(s: string): string {
  try {
    return Buffer.from(decodeURIComponent(s), 'base64').toString('utf8');
  } catch {
    return `[decode-failed: ${s}]`;
  }
}

(async () => {
  const context = await launchSession({ headless: false });
  const page = context.pages()[0] ?? (await context.newPage());

  await page.goto('https://www.bizbuysell.com/hvac-businesses-for-sale/', {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(2000);

  // ----- (1) listing cards -----
  const cards = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('app-listing-diamond, app-listing-showcase, app-listing-standard, app-listing, article'));
    return items.slice(0, 5).map((el) => ({
      tag: el.tagName.toLowerCase(),
      cls: (el as HTMLElement).className?.toString().slice(0, 120),
      outerHTML: (el as HTMLElement).outerHTML.slice(0, 2500),
    }));
  });
  fs.writeFileSync(path.join(OUT_DIR, '06-cards-raw.json'), JSON.stringify(cards, null, 2));
  console.log('[cards] sampled:', cards.length, cards.map((c) => c.tag).join(', '));

  // Look for anchor hrefs that point to a listing detail
  const detailLinks = await page.evaluate(() => {
    const a = Array.from(document.querySelectorAll('a')).map((x) => (x as HTMLAnchorElement).href);
    return Array.from(new Set(a.filter((h) => /\/business-opportunity\/|\/business-for-sale\//.test(h)))).slice(0, 10);
  });
  fs.writeFileSync(path.join(OUT_DIR, '06-detail-links.json'), JSON.stringify(detailLinks, null, 2));
  console.log('[cards] sample detail links:', detailLinks.slice(0, 3));

  // Pull structured card fields — title, href, price, cash flow, location
  const parsedCards = await page.evaluate(() => {
    const cards = document.querySelectorAll('app-listing-diamond, app-listing-showcase, app-listing-standard, app-listing');
    return Array.from(cards).slice(0, 8).map((c) => {
      const titleEl = c.querySelector('h2, h3, a[class*="title" i]');
      const title = titleEl?.textContent?.trim() ?? null;
      const href = (c.querySelector('a[href*="business-opportunity"], a[href*="business-for-sale"]') as HTMLAnchorElement | null)?.href ?? null;
      const txt = (c as HTMLElement).innerText;
      const askMatch = txt.match(/Asking\s+Price:\s*\$?[\d,]+/i);
      const cfMatch = txt.match(/Cash\s+Flow:\s*\$?[\d,]+/i);
      const locMatch = txt.match(/\n([A-Za-z .]+,\s*[A-Z]{2})\n/);
      return { title, href, ask: askMatch?.[0] ?? null, cf: cfMatch?.[0] ?? null, location: locMatch?.[1] ?? null };
    });
  });
  fs.writeFileSync(path.join(OUT_DIR, '06-parsed-cards.json'), JSON.stringify(parsedCards, null, 2));
  console.log('[cards] parsed sample:');
  parsedCards.slice(0, 3).forEach((c) => console.log(' -', c));

  // ----- (2) q= encoding: apply a price filter via UI, then read URL -----
  await page.locator('button.priceRange').click();
  await page.waitForTimeout(800);
  // Pick a min of $100K by choosing a select option if possible
  const selects = page.locator('.priceRange + * select, .dropdown-menu select, select').first();
  const selectCount = await page.locator('select').count();
  console.log('[q-probe] selects visible:', selectCount);
  // Fallback: try clicking "Min Any" dropdown and pick $100,000
  const minAny = page.locator('text=Any Min').first();
  if (await minAny.isVisible().catch(() => false)) {
    await minAny.click();
    await page.waitForTimeout(400);
    const opt = page.locator('text=/\\$100,000$/').first();
    if (await opt.isVisible().catch(() => false)) await opt.click();
    await page.waitForTimeout(400);
  }
  const applyBtn = page.locator('button:has-text("Apply")').first();
  if (await applyBtn.isVisible().catch(() => false)) {
    await applyBtn.click();
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  }
  await page.waitForTimeout(2000);
  const priceUrl = page.url();
  console.log('[q-probe] after price filter URL:', priceUrl);

  // Try adding a cash flow filter via the More Filters modal
  await page.locator('button.more-filter-button.hide-on-mobile').click();
  await page.waitForTimeout(800);
  const cfMin = page.locator('input[placeholder*="Min" i], select').first();
  // Just close it to avoid brittleness; main goal is priceUrl decode
  await page.keyboard.press('Escape').catch(() => {});

  const parsed = new URL(priceUrl);
  const qParam = parsed.searchParams.get('q');
  const decoded = qParam ? b64decode(qParam) : null;
  const report = { priceUrl, qParam, decoded };
  fs.writeFileSync(path.join(OUT_DIR, '06-q-decode.json'), JSON.stringify(report, null, 2));
  console.log('[q-probe]', report);

  await context.close();
})();
