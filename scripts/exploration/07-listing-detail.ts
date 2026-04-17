/**
 * Fetches one listing detail page and extracts the structured fields
 * (price, cash flow, revenue, location, year established, inventory, FFE,
 * employees, reason for selling, support/training). Also saves the raw HTML
 * and a full-page screenshot so we can iterate on selectors later.
 */
import fs from 'fs';
import path from 'path';
import { launchSession } from '../../scrapers/session';

const OUT_DIR = path.resolve(__dirname, 'out');
const RAW_DIR = path.resolve(__dirname, '../../data/raw');
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(RAW_DIR, { recursive: true });

const DETAIL_URL =
  'https://www.bizbuysell.com/business-opportunity/rapidly-growing-hvac-company-in-north-texas-turnkey-operations/2469359/';

(async () => {
  const context = await launchSession({ headless: false });
  const page = context.pages()[0] ?? (await context.newPage());

  const resp = await page.goto(DETAIL_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  console.log('[detail] status:', resp?.status(), 'url:', page.url());
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1500);

  fs.writeFileSync(path.join(RAW_DIR, 'detail-sample.html'), await page.content());
  await page.screenshot({ path: path.join(OUT_DIR, '07-detail.png'), fullPage: true });

  const fields = await page.evaluate(() => {
    const out: Record<string, string | null> = {};
    out.title = document.querySelector('h1')?.textContent?.trim() ?? null;
    out.location = document.querySelector('[class*="location" i]')?.textContent?.trim() ?? null;

    // "Financials" often rendered as a two-column list: label | value
    const rows = document.querySelectorAll('dl, table, [class*="finan" i] tr, [class*="detail" i] li');
    const text = (document.body as HTMLElement).innerText;
    const labels = [
      'Asking Price', 'Cash Flow', 'Gross Revenue', 'EBITDA', 'FF&E', 'Inventory',
      'Established', 'Employees', 'Rent', 'Real Estate',
    ];
    for (const label of labels) {
      const re = new RegExp(`${label}[:\\s]+(\\$?[\\d,]+(?:\\s*(?:included|not included))?|[A-Za-z0-9,.\\s]+)`);
      const m = text.match(re);
      out[label] = m ? m[1].trim().slice(0, 80) : null;
    }

    out.descriptionSnippet = (document.querySelector('[class*="description" i], [class*="businessDescription" i]') as HTMLElement | null)?.innerText?.trim().slice(0, 400) ?? null;
    out.reasonForSelling = (() => {
      const m = text.match(/Reason for Selling[:\s]+([^\n]+)/);
      return m ? m[1].trim() : null;
    })();
    out.supportTraining = (() => {
      const m = text.match(/(?:Support\s*(?:&|and)\s*Training|Training)[:\s]+([^\n]+)/);
      return m ? m[1].trim() : null;
    })();
    return out;
  });

  fs.writeFileSync(path.join(OUT_DIR, '07-detail-fields.json'), JSON.stringify(fields, null, 2));
  console.log('[detail] extracted fields:');
  Object.entries(fields).forEach(([k, v]) => console.log(`  ${k}: ${v}`));

  await context.close();
})();
