/**
 * Loads the main search page (/buy/) and captures:
 *  - full-page screenshot
 *  - raw HTML snapshot
 *  - every form control visible (inputs, selects, checkboxes) with names/values
 *  - all links that look like category/industry filters
 *
 * Output: data/raw/search-buy.html, scripts/exploration/out/02-search-page.png,
 *         scripts/exploration/out/02-search-form-controls.json
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

  const resp = await page.goto('https://www.bizbuysell.com/buy/', {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  console.log('[search] status:', resp?.status(), 'url:', page.url());

  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(2000);

  const title = await page.title();
  console.log('[search] title:', title);
  if (/access denied/i.test(title)) {
    console.error('[search] BLOCKED. Profile cookies may be stale.');
    await context.close();
    process.exit(1);
  }

  fs.writeFileSync(path.join(RAW_DIR, 'search-buy.html'), await page.content());
  await page.screenshot({ path: path.join(OUT_DIR, '02-search-page.png'), fullPage: true });

  const controls = await page.evaluate(() => {
    const out: Array<Record<string, unknown>> = [];
    document.querySelectorAll('input, select, textarea').forEach((el) => {
      const e = el as HTMLInputElement | HTMLSelectElement;
      out.push({
        tag: e.tagName.toLowerCase(),
        type: (e as HTMLInputElement).type ?? null,
        name: e.name,
        id: e.id,
        placeholder: (e as HTMLInputElement).placeholder ?? null,
        value: (e as HTMLInputElement).value ?? null,
        labelText:
          (e.id && document.querySelector(`label[for="${e.id}"]`)?.textContent?.trim()) ||
          e.closest('label')?.textContent?.trim() ||
          null,
      });
    });
    return out;
  });
  fs.writeFileSync(
    path.join(OUT_DIR, '02-search-form-controls.json'),
    JSON.stringify(controls, null, 2),
  );
  console.log('[search] form controls saved:', controls.length);

  const categoryLinks = await page.evaluate(() => {
    const links: Array<{ text: string; href: string }> = [];
    document.querySelectorAll('a').forEach((a) => {
      const href = (a as HTMLAnchorElement).href;
      const text = (a as HTMLElement).innerText.trim();
      if (!href || !text) return;
      if (/\/buy\/|\/businesses-for-sale\/|industry|category/i.test(href)) {
        links.push({ text: text.slice(0, 80), href });
      }
    });
    return links;
  });
  fs.writeFileSync(
    path.join(OUT_DIR, '02-category-links.json'),
    JSON.stringify(categoryLinks, null, 2),
  );
  console.log('[search] category links saved:', categoryLinks.length);

  await context.close();
})();
