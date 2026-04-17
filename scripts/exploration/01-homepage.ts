/**
 * Reuses the warmed persistent profile to load the homepage and snapshot
 * the search/filter UI. Run this AFTER warm-session.ts and at least one
 * manual browsing pass, so cookies exist.
 *
 * Saves: data/raw/homepage.html, scripts/exploration/out/01-homepage.png
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

  const resp = await page.goto('https://www.bizbuysell.com/', {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  console.log('[homepage] status:', resp?.status());

  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});

  const title = await page.title();
  console.log('[homepage] title:', title);

  if (/access denied/i.test(title)) {
    console.error('[homepage] BLOCKED. Run warm-session.ts first and browse manually.');
    await context.close();
    process.exit(1);
  }

  fs.writeFileSync(path.join(RAW_DIR, 'homepage.html'), await page.content());
  await page.screenshot({ path: path.join(OUT_DIR, '01-homepage.png'), fullPage: true });

  const searchInputs = await page
    .locator('input[type="search"], input[name*="keyword" i], input[placeholder*="search" i]')
    .evaluateAll((els) =>
      els.map((el) => ({
        name: (el as HTMLInputElement).name,
        placeholder: (el as HTMLInputElement).placeholder,
        id: el.id,
      })),
    );
  console.log('[homepage] search inputs:', JSON.stringify(searchInputs, null, 2));

  const navLinks = await page
    .locator('header a, nav a')
    .evaluateAll((els) =>
      els.slice(0, 40).map((el) => ({
        text: (el as HTMLElement).innerText.trim().slice(0, 60),
        href: (el as HTMLAnchorElement).href,
      })),
    );
  console.log('[homepage] nav links:', JSON.stringify(navLinks.slice(0, 25), null, 2));

  await context.close();
})();
