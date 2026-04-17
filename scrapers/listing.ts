/**
 * Scrape a single listing detail page and extract structured fields.
 * Regex patterns are defined in Node-side and passed as data into
 * page.evaluate so the browser context never sees a nested named
 * function (avoids tsx's __name helper leak).
 */
import { BrowserContext, Page } from '@playwright/test';

export type ListingDetail = {
  listingId: string | null;
  url: string;
  title: string | null;
  location: string | null;
  askingPrice: number | null;
  cashFlowSde: number | null;
  grossRevenue: number | null;
  ebitda: number | null;
  ffe: number | null;
  inventory: number | null;
  established: number | null;
  employees: number | null;
  realEstate: string | null;
  reasonForSelling: string | null;
  supportTraining: string | null;
  description: string | null;
  fetchedAt: string;
};

function parseMoney(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = s.match(/\$[\d,]+/);
  if (!m) return null;
  const n = Number(m[0].replace(/[$,]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function parseInteger(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = s.match(/\d+/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

function extractId(url: string): string | null {
  const m = url.match(/\/(\d{6,})\/?$/);
  return m?.[1] ?? null;
}

type GrabSpec = { key: string; source: string; cap: number };

const GRABS: GrabSpec[] = [
  { key: 'askingPrice', source: 'Asking Price\\s*[:\\-]?\\s*([^\\n]+?)(?=\\n|$)', cap: 80 },
  { key: 'cashFlowSde', source: 'Cash Flow\\s*[:\\-]?\\s*([^\\n]+?)(?=\\n|$)', cap: 80 },
  { key: 'grossRevenue', source: 'Gross Revenue\\s*[:\\-]?\\s*([^\\n]+?)(?=\\n|$)', cap: 80 },
  { key: 'ebitda', source: 'EBITDA\\s*[:\\-]?\\s*([^\\n]+?)(?=\\n|$)', cap: 80 },
  { key: 'ffe', source: 'FF&E\\s*[:\\-]?\\s*([^\\n]+?)(?=\\n|$)', cap: 80 },
  { key: 'inventory', source: 'Inventory\\s*[:\\-]?\\s*([^\\n]+?)(?=\\n|$)', cap: 80 },
  { key: 'established', source: 'Established\\s*[:\\-]?\\s*([^\\n]+?)(?=\\n|$)', cap: 20 },
  { key: 'employees', source: 'Employees\\s*[:\\-]?\\s*([^\\n]+?)(?=\\n|$)', cap: 20 },
  { key: 'realEstate', source: 'Real Estate\\s*[:\\-]?\\s*([^\\n]+?)(?=\\n|$)', cap: 80 },
  { key: 'reasonForSelling', source: 'Reason for Selling\\s*[:\\-]?\\s*([^\\n]+?)(?=\\n|$)', cap: 200 },
  { key: 'supportTraining', source: '(?:Support\\s*(?:&|and)\\s*Training|Training)\\s*[:\\-]?\\s*([^\\n]+?)(?=\\n|$)', cap: 300 },
];

export async function scrapeListing(
  context: BrowserContext,
  url: string,
): Promise<ListingDetail | null> {
  const page: Page = context.pages()[0] ?? (await context.newPage());
  let resp;
  try {
    resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  } catch (e) {
    console.warn(`[listing] navigation threw: ${(e as Error).message.split('\n')[0]} — ${url}`);
    return null;
  }
  if (!resp || resp.status() >= 400) {
    console.warn(`[listing] ${resp?.status() ?? 'no-resp'} ${url}`);
    return null;
  }
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(600);
  // Double-check: some 403s come through as full pages
  const title = await page.title();
  if (/access denied/i.test(title)) {
    console.warn(`[listing] Access Denied on detail page — ${url}`);
    return null;
  }

  const raw = await page.evaluate((grabs: GrabSpec[]) => {
    const text = (document.body as HTMLElement).innerText;
    const title = document.querySelector('h1')?.textContent?.trim() ?? null;
    const subtitleEl = document.querySelector('h1')?.parentElement?.querySelector(
      'h2, h3, [class*="location" i], [class*="subtitle" i]',
    ) as HTMLElement | null;
    const subtitle = subtitleEl?.innerText?.trim() ?? null;
    const descEl = document.querySelector(
      '[class*="businessDescription" i], [class*="business-description" i], [class*="description" i]',
    ) as HTMLElement | null;
    const description = descEl?.innerText?.trim().slice(0, 2000) ?? null;

    const out: Record<string, string | null> = {};
    for (const g of grabs) {
      const re = new RegExp(g.source);
      const m = text.match(re);
      out[g.key] = m ? m[1].trim().slice(0, g.cap) : null;
    }
    return { title, subtitle, description, ...out };
  }, GRABS);

  return {
    listingId: extractId(url),
    url,
    title: raw.title,
    location: raw.subtitle,
    askingPrice: parseMoney(raw.askingPrice),
    cashFlowSde: parseMoney(raw.cashFlowSde),
    grossRevenue: parseMoney(raw.grossRevenue),
    ebitda: parseMoney(raw.ebitda),
    ffe: parseMoney(raw.ffe),
    inventory: parseMoney(raw.inventory),
    established: parseInteger(raw.established),
    employees: parseInteger(raw.employees),
    realEstate: raw.realEstate,
    reasonForSelling: raw.reasonForSelling,
    supportTraining: raw.supportTraining,
    description: raw.description,
    fetchedAt: new Date().toISOString(),
  };
}
