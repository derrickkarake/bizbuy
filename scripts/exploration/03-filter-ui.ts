/**
 * Captures the filter sidebar / panel in detail.
 * Goes to the canonical /businesses-for-sale/ route, screenshots the viewport
 * (not full page), and enumerates every clickable filter element with its
 * text, aria-label, data-attrs, and nearest heading — so we can map the
 * filter UI to URL params later.
 */
import fs from 'fs';
import path from 'path';
import { launchSession } from '../../scrapers/session';

const OUT_DIR = path.resolve(__dirname, 'out');
const RAW_DIR = path.resolve(__dirname, '../../data/raw');

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(RAW_DIR, { recursive: true });

  const context = await launchSession({ headless: false });
  const page = context.pages()[0] ?? (await context.newPage());

  const resp = await page.goto('https://www.bizbuysell.com/businesses-for-sale/', {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  console.log('[filter-ui] status:', resp?.status(), 'final url:', page.url());

  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(2000);

  fs.writeFileSync(path.join(RAW_DIR, 'businesses-for-sale.html'), await page.content());

  await page.screenshot({
    path: path.join(OUT_DIR, '03-viewport-top.png'),
    fullPage: false,
  });

  await page.evaluate(() => window.scrollTo(0, 400));
  await page.waitForTimeout(500);
  await page.screenshot({
    path: path.join(OUT_DIR, '03-viewport-scroll400.png'),
    fullPage: false,
  });
  await page.evaluate(() => window.scrollTo(0, 0));

  const filterCandidates = await page.evaluate(() => {
    const selectors = [
      'aside',
      '[class*="filter" i]',
      '[class*="Filter"]',
      '[id*="filter" i]',
      '[data-testid*="filter" i]',
      '[aria-label*="filter" i]',
    ];
    const nodes = new Set<Element>();
    selectors.forEach((s) => document.querySelectorAll(s).forEach((n) => nodes.add(n)));
    return Array.from(nodes)
      .slice(0, 20)
      .map((n) => ({
        tag: n.tagName.toLowerCase(),
        cls: (n as HTMLElement).className?.toString().slice(0, 120) ?? '',
        id: n.id,
        aria: n.getAttribute('aria-label'),
        childCount: n.children.length,
        textSnippet: (n as HTMLElement).innerText?.trim().slice(0, 200) ?? '',
      }));
  });
  fs.writeFileSync(
    path.join(OUT_DIR, '03-filter-candidates.json'),
    JSON.stringify(filterCandidates, null, 2),
  );
  console.log('[filter-ui] filter-shaped nodes:', filterCandidates.length);

  const buttons = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('button'))
      .slice(0, 60)
      .map((b) => ({
        text: (b as HTMLElement).innerText.trim().slice(0, 60),
        aria: b.getAttribute('aria-label'),
        cls: b.className?.toString().slice(0, 80),
      }))
      .filter((b) => b.text || b.aria);
  });
  fs.writeFileSync(path.join(OUT_DIR, '03-buttons.json'), JSON.stringify(buttons, null, 2));
  console.log('[filter-ui] buttons captured:', buttons.length);

  const listingCards = await page.evaluate(() => {
    const candidates = document.querySelectorAll(
      'article, [class*="listing" i], [class*="result" i], [data-testid*="listing" i]',
    );
    return Array.from(candidates)
      .slice(0, 5)
      .map((n) => ({
        tag: n.tagName.toLowerCase(),
        cls: (n as HTMLElement).className?.toString().slice(0, 120),
        outerHTMLSnippet: (n as HTMLElement).outerHTML.slice(0, 600),
      }));
  });
  fs.writeFileSync(
    path.join(OUT_DIR, '03-listing-card-samples.json'),
    JSON.stringify(listingCards, null, 2),
  );
  console.log('[filter-ui] listing card samples:', listingCards.length);

  await context.close();
})();
