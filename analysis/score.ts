/**
 * Scoring rubric v2 (see research/scoring-rubric.md).
 * Total 100 pts: scheduling/route-density 20, owner workload 18,
 * recurring 15, size fit 10, price sanity 8, margin benchmark 12,
 * absentee 10, license transferability 7. Soft red flags subtract up to 15.
 */
import type { CardSummary } from '../scrapers/search';
import type { ListingDetail } from '../scrapers/listing';

export type ScoredListing = {
  score: number;
  disqualified: boolean;
  deferred: boolean; // hidden price — worth a manual outreach
  flags: string[];
  categories: {
    schedulingRouteDensity: number;
    ownerWorkload: number;
    recurringRevenue: number;
    sizeFit: number;
    priceSanity: number;
    marginBenchmark: number;
    absenteeFit: number;
    licenseTransferability: number;
    softPenalty: number;
  };
  sdeMultiple: number | null;
  sdeMargin: number | null;
  listing: CardSummary;
  detail: ListingDetail | null;
};

// --- keyword banks ---
const DISQUAL_INDUSTRY_KEYWORDS = [
  'restaurant', 'cafe', 'bakery', 'bar & grill', 'pizzeria', 'sushi',
  'franchise for sale', 'franchise resale',
  'medical practice', 'dental practice', 'law firm',
];
const ROUTE_KEYWORDS = [
  'route', 'routes', 'route-based', 'dispatch', 'routing', 'scheduling',
  'appointment', 'service call', 'callout', 'on-call', 'territory', 'territories',
  'maintenance agreement', 'maintenance agreements', 'service agreement',
  'service agreements', 'crm in place', 'route density',
];
const OWNER_WORKLOAD_KEYWORDS = [
  'owner handles', 'owner does', 'owner-operator', 'owner operator',
  'owner answers', 'answers phone', 'quoting', 'estimates', 'schedules',
  'books appointments', 'wears many hats',
];
const RECURRING_KEYWORDS = [
  'recurring', 'contract', 'contracts', 'service agreement', 'subscription',
  'maintenance plan', 'maintenance agreement', 'retainer', 'membership',
  'monthly recurring', '% recurring', 'repeat customer', 'repeat clientele',
];
const ABSENTEE_KEYWORDS = [
  'absentee', 'semi-absentee', 'semi absentee', 'owner-light', 'owner light',
  'manager in place', 'turnkey', '1099', 'contractor labor', 'home-based',
  'home based',
];
const CUSTOMER_CONCENTRATION_KEYWORDS = [
  'top customer', 'largest account', 'one contract represents', 'single customer',
  'one account', 'concentration',
];
const TECH_DEPENDENT_KEYWORDS = [
  'lead tech', 'senior technician', 'key employee', 'key technician',
  'master plumber', 'master electrician',
];
const OWNER_FACE_KEYWORDS = [
  'personal relationships', 'owner is the face', 'long-standing relationships',
  'owner\'s reputation',
];
const LICENSE_LOCK_KEYWORDS = [
  'licensed plumber required', 'licensed electrician required',
  'licensed contractor required', 'master plumber owner',
  'master electrician owner', 'licensed owner', 'license required',
];
const DEFERRED_CAPEX_KEYWORDS = [
  'fleet due for replacement', 'equipment nearing end of life',
  'vehicles near replacement',
];
const QUALIFIER_STAYS_KEYWORDS = [
  'licensed lead tech staying', 'license will transfer', 'transition period',
  'seller will stay', 'willing to stay', 'extended transition',
];

// --- industry metadata ---
const REGULATED_INDUSTRIES = new Set(['plumbing', 'hvac', 'electrical', 'pest-control']);
const UNREGULATED_INDUSTRIES = new Set(['cleaning', 'service', 'landscaping']);

const INDUSTRY_MARGIN_BENCHMARK: Record<string, number> = {
  'pest-control': 0.34,
  'cleaning': 0.30,
  'landscaping': 0.28,
  'hvac': 0.22,
  'plumbing': 0.22,
  'electrical': 0.22,
  'service': 0.25,
  'building-and-construction': 0.20,
};

// --- helpers ---
function textHas(haystack: string, needles: string[]): string | null {
  const hay = haystack.toLowerCase();
  for (const n of needles) if (hay.includes(n)) return n;
  return null;
}

// Regional multiple ceilings, keyed by state slug. DFW (TX metro) is tighter.
function regionalMultipleCeiling(stateSlug: string, location: string | null): number {
  const loc = (location ?? '').toLowerCase();
  if (stateSlug === 'texas' && /(dallas|fort worth|tarrant|collin|denton|plano|arlington|dfw)/.test(loc)) {
    return 2.85;
  }
  if (stateSlug === 'oklahoma' || stateSlug === 'arkansas') return 3.0;
  if (stateSlug === 'texas') return 2.95;
  return 3.0;
}

export function scoreListing(
  card: CardSummary,
  detail: ListingDetail | null,
  industrySlug: string,
  stateSlug: string,
): ScoredListing {
  const flags: string[] = [];
  const title = (card.title ?? detail?.title ?? '').toLowerCase();
  const snippet = (card.descriptionSnippet ?? '').toLowerCase();
  const desc = (detail?.description ?? '').toLowerCase();
  const corpus = `${title}\n${snippet}\n${desc}`;

  const ask = detail?.askingPrice ?? card.askingPrice ?? null;
  const sde = detail?.cashFlowSde ?? card.cashFlow ?? null;
  const revenue = detail?.grossRevenue ?? null;
  const employees = detail?.employees ?? null;
  const location = detail?.location ?? card.location;

  const sdeMultiple = ask !== null && sde !== null && sde > 0 ? ask / sde : null;
  const sdeMargin = sde !== null && revenue !== null && revenue > 0 ? sde / revenue : null;

  // --- deferred (hidden price) ---
  const deferred = ask === null;

  // --- hard disqualifiers ---
  let disqualified = false;
  if (DISQUAL_INDUSTRY_KEYWORDS.some((k) => title.includes(k) || snippet.includes(k))) {
    disqualified = true;
    flags.push('dq:industry-keyword');
  }
  // Franchise resale catch-all: title containing "franchise" is almost
  // always a franchise resale, regardless of phrasing. Also catches
  // detail descriptions that explicitly identify as franchise.
  if (/\bfranchise\b/i.test(title) || /established\s+\w+\s+franchise|franchise model|is a franchise/i.test(desc)) {
    disqualified = true;
    flags.push('dq:franchise');
  }
  if (ask !== null && ask > 3_000_000) {
    disqualified = true;
    flags.push('dq:too-expensive');
  }
  if (sde !== null && sde < 50_000) {
    disqualified = true;
    flags.push('dq:sde-too-low');
  }

  // --- category 1: scheduling / route density (20) ---
  let schedulingRouteDensity = 0;
  if (textHas(corpus, ROUTE_KEYWORDS)) schedulingRouteDensity = 20;
  else if (['hvac', 'plumbing', 'pest-control', 'cleaning', 'landscaping', 'electrical'].includes(industrySlug))
    schedulingRouteDensity = 12;
  else if (industrySlug === 'service' || industrySlug === 'building-and-construction')
    schedulingRouteDensity = 6;

  // --- category 2: owner workload (18) ---
  let ownerWorkload = 0;
  if (textHas(corpus, OWNER_WORKLOAD_KEYWORDS)) ownerWorkload = 18;
  else if (employees !== null && employees > 0 && employees < 10) ownerWorkload = 10;
  else if (employees !== null && employees >= 10 && employees <= 25) ownerWorkload = 5;
  else if (employees !== null && employees > 25) ownerWorkload = 0;

  // --- category 3: recurring revenue (15) ---
  let recurringRevenue = 0;
  if (textHas(corpus, RECURRING_KEYWORDS)) recurringRevenue = 15;
  else if (['pest-control', 'cleaning', 'hvac', 'landscaping'].includes(industrySlug)) recurringRevenue = 8;

  // --- category 4: size fit (10) ---
  let sizeFit = 0;
  if (sde !== null && ask !== null) {
    const inSdeBand = sde >= 100_000 && sde <= 400_000;
    const inAskBand = ask >= 150_000 && ask <= 1_500_000;
    const empOk = employees === null || employees <= 15;
    if (inSdeBand && inAskBand && empOk) sizeFit = 10;
    else if (sde >= 400_000 && sde <= 750_000 && ask <= 2_000_000) sizeFit = 5;
    else if (sde < 75_000) sizeFit = 0;
    else sizeFit = 3;
  } else if (ask !== null && ask <= 1_500_000) {
    sizeFit = 5;
  }

  // --- category 5: price sanity vs regional multiple (8) ---
  let priceSanity = 0;
  if (sdeMultiple !== null) {
    const ceiling = regionalMultipleCeiling(stateSlug, location);
    if (sdeMultiple <= ceiling) priceSanity = 8;
    else if (sdeMultiple <= ceiling * 1.2) priceSanity = 4;
    else {
      priceSanity = 0;
      flags.push(`price-high:${sdeMultiple.toFixed(2)}x-vs-${ceiling.toFixed(2)}x`);
    }
  }

  // --- category 6: margin benchmark (12) ---
  let marginBenchmark = 0;
  if (sdeMargin !== null) {
    const bench = INDUSTRY_MARGIN_BENCHMARK[industrySlug] ?? 0.25;
    const bandLow = bench - 0.05;
    const bandHigh = bench + 0.15;
    if (sdeMargin >= bandLow && sdeMargin <= bandHigh) marginBenchmark = 12;
    else if (sdeMargin >= bandLow - 0.05 && sdeMargin <= bandHigh + 0.05) marginBenchmark = 6;
    else if (sdeMargin < 0.05 || sdeMargin > 0.60) marginBenchmark = 0;
    else marginBenchmark = 3;
  }

  // --- category 7: absentee / manager-ready (10) ---
  let absenteeFit = 0;
  if (textHas(corpus, ABSENTEE_KEYWORDS)) absenteeFit = 10;
  else if (detail?.supportTraining && /transition|willing to stay|training|extended/i.test(detail.supportTraining))
    absenteeFit = 5;

  // --- category 8: license transferability (7) ---
  let licenseTransferability = 0;
  const qualifierStaying = textHas(corpus, QUALIFIER_STAYS_KEYWORDS) !== null;
  if (UNREGULATED_INDUSTRIES.has(industrySlug)) {
    licenseTransferability = 7;
  } else if (REGULATED_INDUSTRIES.has(industrySlug)) {
    if (qualifierStaying) licenseTransferability = 7;
    else if (detail?.supportTraining && /transition|willing to stay|training/i.test(detail.supportTraining))
      licenseTransferability = 3;
    else {
      licenseTransferability = 0;
      flags.push('license-risk');
    }
  } else {
    licenseTransferability = 5;
  }

  // --- soft red flags (subtract, capped at 15) ---
  let softPenalty = 0;
  const redFlagChecks: Array<[string, string[]]> = [
    ['red:customer-concentration', CUSTOMER_CONCENTRATION_KEYWORDS],
    ['red:tech-dependent', TECH_DEPENDENT_KEYWORDS],
    ['red:owner-face', OWNER_FACE_KEYWORDS],
    ['red:license-lock', LICENSE_LOCK_KEYWORDS],
    ['red:deferred-capex', DEFERRED_CAPEX_KEYWORDS],
  ];
  for (const [flag, words] of redFlagChecks) {
    if (textHas(corpus, words)) {
      softPenalty += 5;
      flags.push(flag);
    }
  }
  softPenalty = Math.min(softPenalty, 15);

  // --- missing-data flags ---
  if (ask === null) flags.push('no-asking-price');
  if (sde === null) flags.push('no-sde');
  if (revenue === null) flags.push('no-revenue');

  const positive =
    schedulingRouteDensity +
    ownerWorkload +
    recurringRevenue +
    sizeFit +
    priceSanity +
    marginBenchmark +
    absenteeFit +
    licenseTransferability;

  const score = disqualified ? 0 : Math.max(0, positive - softPenalty);

  return {
    score,
    disqualified,
    deferred,
    flags,
    categories: {
      schedulingRouteDensity,
      ownerWorkload,
      recurringRevenue,
      sizeFit,
      priceSanity,
      marginBenchmark,
      absenteeFit,
      licenseTransferability,
      softPenalty,
    },
    sdeMultiple,
    sdeMargin,
    listing: card,
    detail,
  };
}
