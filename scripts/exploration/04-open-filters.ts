/**
 * Opens each filter dropdown (Industries, Listing Types, Price Range,
 * More Filters) and screenshots the panel. Also applies one representative
 * filter per panel and captures the resulting URL so we can reverse-engineer
 * the query-string encoding.
 */
import fs from 'fs';
import path from 'path';
import { launchSession } from '../../scrapers/session';

const OUT_DIR = path.resolve(__dirname, 'out');
fs.mkdirSync(OUT_DIR, { recursive: true });

(async () => {
  const context = await launchSession({ headless: false });
  const page = context.pages()[0] ?? (await context.newPage());

  await page.goto('https://www.bizbuysell.com/businesses-for-sale/', {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1500);

  const urlLog: Array<{ step: string; url: string }> = [];
  urlLog.push({ step: 'initial', url: page.url() });

  async function clickAndShoot(selector: string, label: string) {
    try {
      const el = page.locator(selector).first();
      if (!(await el.isVisible({ timeout: 2000 }))) {
        console.log(`[${label}] not visible`);
        return false;
      }
      await el.click();
      await page.waitForTimeout(1200);
      await page.screenshot({ path: path.join(OUT_DIR, `04-${label}-open.png`), fullPage: false });
      console.log(`[${label}] opened + shot`);
      return true;
    } catch (e) {
      console.log(`[${label}] error:`, (e as Error).message);
      return false;
    }
  }

  async function closePanel() {
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(400);
    await page.mouse.click(10, 400).catch(() => {});
    await page.waitForTimeout(400);
  }

  await clickAndShoot('button.industry-btn', 'industries');
  await closePanel();

  await clickAndShoot('button.listing-types-button', 'listing-types');
  await closePanel();

  await clickAndShoot('button.priceRange', 'price-range');
  await closePanel();

  await clickAndShoot('button.more-filter-button.hide-on-mobile', 'more-filters');
  await closePanel();

  // Try to find the location pill — likely first filter-bar button
  const locationButton = page.locator('button.filter-bar').first();
  if (await locationButton.isVisible().catch(() => false)) {
    await locationButton.click();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(OUT_DIR, `04-locations-open.png`), fullPage: false });
    await closePanel();
  }

  // Now: apply one industry filter and watch URL
  await page.locator('button.industry-btn').first().click();
  await page.waitForTimeout(1000);
  const panelHtml = await page
    .locator('.industry-filter, .filter-panel, .dropdown-menu.show, [class*="industry" i]')
    .first()
    .innerHTML()
    .catch(() => '');
  fs.writeFileSync(path.join(OUT_DIR, '04-industries-panel.html'), panelHtml.slice(0, 20000));

  const firstCheckbox = page.locator('input[type="checkbox"]').first();
  if (await firstCheckbox.isVisible().catch(() => false)) {
    await firstCheckbox.check({ force: true }).catch(() => {});
    await page.waitForTimeout(500);
  }
  // Try clicking an "Apply" or "Done" button in the open panel
  const applyBtn = page
    .locator('button:has-text("Apply"), button:has-text("Done"), button:has-text("Update")')
    .first();
  if (await applyBtn.isVisible().catch(() => false)) {
    await applyBtn.click();
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  }
  await page.waitForTimeout(2000);
  urlLog.push({ step: 'after-first-industry', url: page.url() });

  fs.writeFileSync(path.join(OUT_DIR, '04-url-log.json'), JSON.stringify(urlLog, null, 2));
  console.log('[url-log]', JSON.stringify(urlLog, null, 2));

  await context.close();
})();
