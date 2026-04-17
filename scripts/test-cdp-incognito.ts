/**
 * Connect to the already-running Chrome via CDP and open an INCOGNITO
 * context (new browserContextId), then navigate in it.
 */
import { chromium } from '@playwright/test';

(async () => {
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const ctx = await browser.newContext(); // Playwright maps this to a new incognito-like context on CDP
  const page = await ctx.newPage();

  const r = await page.goto('https://www.bizbuysell.com/', {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  }).catch((e) => { console.log('NAV THREW:', e.message.split('\n')[0]); return null; });

  if (r) {
    console.log('status:', r.status(), 'title:', (await page.title()).slice(0, 60));
  }
  await browser.close();
})();
