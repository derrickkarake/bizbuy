# Scoring rubric v2 — "AI-optimize & side-income fit"

Updated 2026-04-16 with licensing, regional multiple, route-density, and customer-concentration lenses from the acquisition-targets memo.

Thesis: buy a small service business in OK/TX/AR that (a) is small enough to run part-time with a 4-person team, (b) has operational friction an AI agent can absorb (call capture, scheduling, dispatch, quote follow-up, renewal nudges), (c) has recurring route or contract revenue, and (d) doesn't require a license the buyer doesn't hold.

Each listing is scored 0–100. Sub-scores sum. Detail-page fields get more weight; card-only listings get partial credit from keywords. Disqualifiers short-circuit to score 0.

## Categories (100 pts)

### 1. Scheduling / route density (20 pts)
Route-based or dispatch-heavy → AI has something to optimize.
- +20 — Description mentions explicit route density, routes, territories, dispatch, maintenance agreements, recurring service calls, route-based service, CRM in place.
- +12 — Industry implies it (HVAC, plumbing, pest control, cleaning, landscaping, electrical service).
- +6 — Service business (generic) without explicit scheduling mention.
- +0 — Non-dispatched (retail, e-commerce, manufacturing, project-only).

### 2. Owner workload AI can replace (18 pts)
Does the owner answer phones, quote, schedule, chase invoices?
- +18 — Description says owner handles calls/quoting/scheduling/estimates/follow-up OR owner-operator with <10 employees.
- +10 — Small staff (<10 employees) inferred, no explicit owner-task list.
- +5 — Staff 10–25 with some admin infrastructure.
- +0 — 25+ employees with existing admin/dispatch (AI displaces cost, not owner time — lower upside for side-income).

### 3. Recurring / contract revenue (15 pts)
Predictable dispatch = AI ROI. Also signals transferable enterprise value.
- +15 — Detail or description explicitly cites: recurring, contracts, service agreements, subscription, maintenance plans, membership, X% recurring, $/month recurring.
- +8 — Industry implies recurrence (pest control, cleaning, HVAC maintenance, landscaping).
- +0 — One-off transactional, project-based, or no signal.

### 4. Size fit for side-income operators (10 pts)
Target band: SBA-financeable, four-person team can start part-time.
- +10 — SDE $100K–$400K and asking $150K–$1.5M and employees ≤15.
- +5 — SDE $400K–$750K or asking up to $2M (still buyable, closer to full-time).
- +0 — SDE <$75K, SDE >$1M, or asking >$3M (auto-DQ elsewhere).

### 5. Price sanity vs. regional SDE multiple (8 pts)
Reference 2025 BizBuySell closed-deal medians: OKC ~2.55x, Tulsa ~2.34x, Wichita ~2.66x, DFW ~2.54x. We use a **3.0x ceiling** for OK/AR and **2.85x for DFW/TX metros** with a tolerance band.
- +8 — asking / SDE ≤ regional ceiling.
- +4 — 1–20% over ceiling (negotiable).
- +0 — >20% over ceiling, OR ask or SDE missing (can't score).

### 6. Margin headroom vs. industry benchmark (12 pts)
From the memo's active-listing medians:
  pest control 34%, cleaning 30%, landscaping 28%, HVAC 22%, plumbing 22%, electrical 22%.
Use industry-specific "healthy but not maxed" band = benchmark − 5 to benchmark + 15.
- +12 — SDE/Revenue within the healthy band → room to add margin via AI.
- +6 — within ±5 pts of the band edge.
- +0 — <5% or >60% (either constrained or inflated by owner-labor add-backs), or missing.

### 7. Absentee / manager-ready (10 pts)
- +10 — Absentee, semi-absentee, owner-light, manager in place, 1099 contractor labor, home-based.
- +5 — Seller willing to stay / train / transition.
- +0 — Owner-critical, face-of-business, licensed-owner-required with no qualifier path.

### 8. License transferability (7 pts)
OK/TX/AR all regulate trade work. OK specifically: plumbing / HVAC / electrical require trade license; pest control requires applicator license (OK Dept. of Agriculture).
- +7 — Industry is unregulated (cleaning, some service-route businesses) OR seller explicitly offers multi-month transition with their license OR listing states a licensed lead tech is staying.
- +3 — Regulated industry with seller willing to stay (generic "transition support") but no explicit qualifier plan.
- +0 — Regulated industry, no qualifier path disclosed. (Not an auto-DQ — buyer may hold license or hire qualifier — but penalizes until verified.)

## Hard disqualifiers (score 0)

- Industries: restaurant, cafe, food service, medical, dental, legal, any licensed-professional-required where no qualifier path exists.
- Franchise resale (royalty + territorial drag erases AI margin gains).
- Asking price > $3M or SDE < $50K.
- Start-up / pre-revenue.

Listings where the asking price is hidden ("Contact for price") are **deferred, not DQ'd** — surfaced separately for manual outreach.

## Soft red flags (subtract 5 each, capped at −15)

Checked against detail-page description text:

- **Customer concentration**: "top customer," "largest account accounts for X%," "one contract represents," "single customer."
- **Technician-dependent**: "lead tech has been with company X years," "key employee," "senior technician."
- **Owner-as-face**: "long-standing personal relationships," "owner's reputation in community."
- **Seller license non-transferable**: "master plumber owner," "licensed HVAC owner" with no qualifier path mentioned.
- **Large deferred capex**: "fleet due for replacement," "equipment nearing end of life."
- **Franchise-adjacent**: "royalty," "franchise fee" (should already DQ, but catch near-misses).

## Keyword signals (positive)

dispatch, routing, scheduling, appointment, route density, service agreements, maintenance plans, recurring, contracts, subscription, CRM in place, absentee, semi-absentee, owner-light, turnkey, manager in place, 1099 labor, home-based, transition period, seller will stay, SBA pre-qualified.

## Keyword signals (negative)

licensed plumber required, master electrician owner, personal relationships, owner is the face, sole-proprietor, one key employee, project-based, bid-based, one-off, emergency-only (without maintenance base), gov contract concentration (unless diversified).

## First-pass output

CSV: `score | listing_id | title | state | industry | asking_price | sde | revenue | sde_multiple | sde_margin | employees | location | flags | url`

Sorted by score desc. DQ'd listings excluded (count reported). Deferred (no-price) listings in a separate tab/section.

## Changelog

- **v2 (2026-04-16)** — added license transferability (cat 8), price sanity vs regional multiple (cat 5), replaced flat margin band with industry-specific benchmark, added route-density to scheduling category, formalized soft red flags.
- **v1** — initial 6-category rubric (scheduling, owner workload, recurring, size fit, margin, absentee).
