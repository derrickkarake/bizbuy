/**
 * Scrape one search page (e.g. /texas/hvac-businesses-for-sale/) and return
 * a list of card-level listing summaries. First-pass — page 1 only.
 */
import { BrowserContext, Page } from '@playwright/test';

export type CardSummary = {
  listingId: string | null;
  url: string;
  title: string | null;
  location: string | null;
  askingPrice: number | null;
  cashFlow: number | null;
  descriptionSnippet: string | null;
  sourceUrl: string;
};

function parseMoney(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = s.match(/\$[\d,]+/);
  if (!m) return null;
  const n = Number(m[0].replace(/[$,]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function extractId(url: string): string | null {
  const m = url.match(/\/(\d{6,})\/?$/);
  return m?.[1] ?? null;
}

export async function scrapeSearchPage(
  context: BrowserContext,
  url: string,
): Promise<CardSummary[]> {
  const page: Page = context.pages()[0] ?? (await context.newPage());
  const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  if (resp && resp.status() >= 400) {
    console.warn(`[search] ${resp.status()} ${url}`);
    return [];
  }
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(800);

  const raw = await page.evaluate(() => {
    const cards = document.querySelectorAll(
      'app-listing-diamond, app-listing-showcase, app-listing-standard',
    );
    return Array.from(cards).map((c) => {
      const a = c.querySelector(
        'a[href*="business-opportunity"], a[href*="business-for-sale"]',
      ) as HTMLAnchorElement | null;
      const href = a?.href ?? null;
      const titleEl =
        c.querySelector('h2 a, h3 a, h2, h3, a[class*="title" i]') ||
        c.querySelector('a[href*="business-opportunity"]');
      const title = (titleEl as HTMLElement | null)?.innerText?.trim().split('\n')[0] ?? null;
      const txt = (c as HTMLElement).innerText;
      const askMatch = txt.match(/Asking\s*Price[:\s]*\$[\d,]+/i);
      const cfMatch = txt.match(/Cash\s*Flow[:\s]*\$[\d,]+/i);
      const locMatch = txt.match(/([A-Za-z .'-]+,\s*[A-Z]{2})/);
      // Description snippet = first big paragraph after title
      const pEl = c.querySelector('p, [class*="summary" i], [class*="desc" i]');
      const snippet = (pEl as HTMLElement | null)?.innerText?.trim() ?? null;
      return {
        href,
        title,
        ask: askMatch?.[0] ?? null,
        cf: cfMatch?.[0] ?? null,
        location: locMatch?.[1] ?? null,
        snippet: snippet?.slice(0, 500) ?? null,
      };
    });
  });

  const out: CardSummary[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    if (!r.href) continue;
    if (seen.has(r.href)) continue;
    seen.add(r.href);
    out.push({
      listingId: extractId(r.href),
      url: r.href,
      title: r.title,
      location: r.location,
      askingPrice: parseMoney(r.ask),
      cashFlow: parseMoney(r.cf),
      descriptionSnippet: r.snippet,
      sourceUrl: url,
    });
  }
  return out;
}
