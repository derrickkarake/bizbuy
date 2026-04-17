import { chromium } from '@playwright/test';

(async () => {
  const browser = await chromium.launch({
    headless: false,
    channel: 'chrome',
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
    locale: 'en-US',
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });
  const page = await context.newPage();
  await page.goto('https://www.bizbuysell.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(3000);
  await page.screenshot({ path: 'scripts/bizbuysell.png', fullPage: false });
  const title = await page.title();
  const headings = await page.locator('h1, h2, h3').allInnerTexts();
  const nav = await page.locator('nav a, header a').allInnerTexts();
  console.log('TITLE:', title);
  console.log('HEADINGS:', JSON.stringify(headings.slice(0, 30)));
  console.log('NAV:', JSON.stringify(nav.slice(0, 30)));
  await browser.close();
})();
