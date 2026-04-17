/**
 * First-pass driver: walk OK/TX/AR × {service, plumbing, hvac, pest-control,
 * cleaning, building-and-construction}, collect card-level listings, fetch
 * detail pages for the non-obvious-rejects, score every listing, and emit:
 *   - data/listings/<listing-id>.json  (per-listing detail)
 *   - data/shortlist.csv               (ranked output)
 *   - data/first-pass-summary.json     (run stats)
 */
import fs from 'fs';
import path from 'path';
import { launchSession } from '../scrapers/session';
import { scrapeSearchPage, CardSummary } from '../scrapers/search';
import { scrapeListing, ListingDetail } from '../scrapers/listing';
import { scoreListing, ScoredListing } from '../analysis/score';

const STATES = ['oklahoma', 'texas', 'arkansas'];
const INDUSTRIES = ['service', 'plumbing', 'hvac', 'pest-control', 'cleaning', 'building-and-construction'];

const DATA_DIR = path.resolve(__dirname, '../data');
const LISTINGS_DIR = path.join(DATA_DIR, 'listings');
const SHORTLIST_CSV = path.join(DATA_DIR, 'shortlist.csv');
const SUMMARY_JSON = path.join(DATA_DIR, 'first-pass-summary.json');

const DETAIL_CAP = 60; // max detail fetches per run
const SLEEP_BETWEEN_NAV_MS = 1500;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function stateSlugFromUrl(url: string): string | null {
  const m = url.match(/bizbuysell\.com\/([a-z-]+)(?:\/|$)/);
  const slug = m?.[1];
  if (!slug) return null;
  if (STATES.includes(slug)) return slug;
  // industry-only URL — no state
  return null;
}

function industrySlugFromUrl(url: string): string | null {
  const m = url.match(/\/([a-z-]+)-businesses-for-sale\//);
  return m?.[1] ?? null;
}

function toCSVRow(fields: Array<string | number | null>): string {
  return fields
    .map((f) => {
      if (f === null || f === undefined) return '';
      const s = String(f).replace(/"/g, '""');
      return /[",\n]/.test(s) ? `"${s}"` : s;
    })
    .join(',');
}

(async () => {
  fs.mkdirSync(LISTINGS_DIR, { recursive: true });
  const startedAt = new Date().toISOString();

  const context = await launchSession({ headless: false });

  // ---- Phase 1: collect card-level listings across all combos ----
  const allCards: Array<CardSummary & { stateSlug: string; industrySlug: string }> = [];
  const perCombo: Record<string, number> = {};

  for (const state of STATES) {
    for (const industry of INDUSTRIES) {
      const url = `https://www.bizbuysell.com/${state}/${industry}-businesses-for-sale/`;
      process.stdout.write(`[search] ${state}/${industry} ... `);
      try {
        const cards = await scrapeSearchPage(context, url);
        perCombo[`${state}/${industry}`] = cards.length;
        for (const c of cards) {
          allCards.push({ ...c, stateSlug: state, industrySlug: industry });
        }
        console.log(`${cards.length} cards`);
      } catch (e) {
        console.log(`ERR ${(e as Error).message}`);
        perCombo[`${state}/${industry}`] = -1;
      }
      await sleep(SLEEP_BETWEEN_NAV_MS);
    }
  }

  // Dedupe by listingId (a listing in "service" may also show up in "hvac")
  const byId = new Map<string, typeof allCards[number]>();
  for (const c of allCards) {
    const key = c.listingId ?? c.url;
    if (!byId.has(key)) byId.set(key, c);
  }
  const uniqueCards = Array.from(byId.values());
  console.log(`\n[phase-1] ${allCards.length} total, ${uniqueCards.length} unique after dedupe`);

  // ---- Phase 2: pre-score on card data to pick who gets a detail fetch ----
  const preScored: ScoredListing[] = uniqueCards.map((c) =>
    scoreListing(c, null, c.industrySlug, c.stateSlug),
  );

  // Sort by pre-score desc, filter out DQs, cap
  const detailTargets = preScored
    .filter((s) => !s.disqualified)
    .sort((a, b) => b.score - a.score)
    .slice(0, DETAIL_CAP)
    .map((s) => s.listing);

  console.log(`[phase-2] fetching detail for ${detailTargets.length} listings`);

  // ---- Phase 3: detail fetches ----
  const details = new Map<string, ListingDetail>();
  let idx = 0;
  for (const card of detailTargets) {
    idx++;
    process.stdout.write(`  [${idx}/${detailTargets.length}] ${card.listingId} ... `);
    try {
      const d = await scrapeListing(context, card.url);
      if (d) {
        details.set(card.listingId ?? card.url, d);
        fs.writeFileSync(
          path.join(LISTINGS_DIR, `${card.listingId ?? 'nonid'}.json`),
          JSON.stringify(d, null, 2),
        );
        console.log(`ask=${d.askingPrice} sde=${d.cashFlowSde}`);
      } else {
        console.log('no-detail');
      }
    } catch (e) {
      console.log(`ERR ${(e as Error).message}`);
    }
    await sleep(SLEEP_BETWEEN_NAV_MS);
  }

  // ---- Phase 4: final scoring with detail data, write CSV ----
  const finalScored: ScoredListing[] = uniqueCards.map((c) =>
    scoreListing(c, details.get(c.listingId ?? c.url) ?? null, c.industrySlug, c.stateSlug),
  );
  const ranked = finalScored.filter((s) => !s.disqualified).sort((a, b) => b.score - a.score);
  const disqualified = finalScored.filter((s) => s.disqualified);
  const deferred = finalScored.filter((s) => !s.disqualified && s.deferred);

  const header = [
    'score', 'listing_id', 'title', 'state', 'industry',
    'asking_price', 'cash_flow_sde', 'gross_revenue',
    'sde_multiple', 'sde_margin', 'employees',
    'location', 'flags', 'url',
  ];
  const rows: string[] = [toCSVRow(header)];
  for (const s of ranked) {
    const d = s.detail;
    const card = s.listing as CardSummary & { stateSlug?: string; industrySlug?: string };
    const state = (card as any).stateSlug ?? stateSlugFromUrl(card.sourceUrl);
    const industry = (card as any).industrySlug ?? industrySlugFromUrl(card.sourceUrl);
    rows.push(
      toCSVRow([
        s.score,
        card.listingId,
        card.title ?? d?.title ?? '',
        state,
        industry,
        d?.askingPrice ?? card.askingPrice,
        d?.cashFlowSde ?? card.cashFlow,
        d?.grossRevenue ?? null,
        s.sdeMultiple !== null ? s.sdeMultiple.toFixed(2) : null,
        s.sdeMargin !== null ? s.sdeMargin.toFixed(3) : null,
        d?.employees ?? null,
        d?.location ?? card.location,
        s.flags.join('|'),
        card.url,
      ]),
    );
  }
  fs.writeFileSync(SHORTLIST_CSV, rows.join('\n'));

  const summary = {
    startedAt,
    finishedAt: new Date().toISOString(),
    states: STATES,
    industries: INDUSTRIES,
    perCombo,
    totals: {
      rawCards: allCards.length,
      uniqueCards: uniqueCards.length,
      detailFetched: details.size,
      scored: finalScored.length,
      kept: ranked.length,
      disqualified: disqualified.length,
      deferred: deferred.length,
    },
    topTen: ranked.slice(0, 10).map((s) => ({
      score: s.score,
      listingId: s.listing.listingId,
      title: s.listing.title ?? s.detail?.title ?? null,
      ask: s.detail?.askingPrice ?? s.listing.askingPrice ?? null,
      sde: s.detail?.cashFlowSde ?? s.listing.cashFlow ?? null,
      url: s.listing.url,
      flags: s.flags,
    })),
  };
  fs.writeFileSync(SUMMARY_JSON, JSON.stringify(summary, null, 2));

  console.log('\n[done]');
  console.log(`  unique listings: ${uniqueCards.length}`);
  console.log(`  details fetched: ${details.size}`);
  console.log(`  kept (scored):   ${ranked.length}`);
  console.log(`  deferred (hidden price): ${deferred.length}`);
  console.log(`  disqualified:    ${disqualified.length}`);
  console.log(`\nShortlist → ${path.relative(process.cwd(), SHORTLIST_CSV)}`);
  console.log(`Summary   → ${path.relative(process.cwd(), SUMMARY_JSON)}`);

  await context.close();
})();
