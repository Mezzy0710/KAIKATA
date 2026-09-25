// Did the wants stock captured by the extension beat the cart? Pure: the optimizer is
// injected, so this module only orchestrates two runs and describes the difference.
//
//   1. cart only             → the reference plan (€A)
//   2. cart + wants stock    → the candidate plan (€B)
// The candidate plan is shown only when it is strictly better; otherwise the cart-only
// plan is shown unchanged, so "nothing better" really means "your plan uses only cart items".

export const SAVINGS_EPSILON = 0.005;
export const SLOW_CANDIDATE_RUN_MS = 1000;

const defaultClock = () => globalThis.performance?.now?.() ?? Date.now();

// cart / merged: { sellers, offerGroups } (merged also carries mergeCandidateOffers stats).
// optimize(sellers, offerGroups) → optimizeCart result.
// captures: the wants-stock captures that were transferred (after the extension's filter).
export function optimizeWithCandidates({
  cart,
  merged = null,
  optimize,
  captures = [],
  excluded = null,
  fallback = false,
  clock = defaultClock
}) {
  const cartStart = clock();
  const cartResult = optimize(cart.sellers, cart.offerGroups);
  const timings = { cartMs: clock() - cartStart, candidateMs: null };

  let candidateResult = null;
  if (merged && captures.length) {
    // No offer survived the merge (all for other cards / already in the cart): the
    // second run would only repeat the first.
    if ((merged.stats?.afterFilter ?? 1) > 0) {
      const candidateStart = clock();
      candidateResult = optimize(merged.sellers, merged.offerGroups);
      timings.candidateMs = clock() - candidateStart;
    } else {
      candidateResult = cartResult;
      timings.candidateMs = 0;
    }
  }

  const impact = buildCandidateImpact({
    cartResult,
    candidateResult,
    stats: merged?.stats || null,
    captures,
    cartSellerCount: cart.sellers.length,
    excluded,
    fallback,
    timings
  });
  return {
    result: impact.state === "improved" ? candidateResult : cartResult,
    cartResult,
    candidateResult,
    impact
  };
}

export function buildCandidateImpact({
  cartResult,
  candidateResult = null,
  stats = null,
  captures = [],
  cartSellerCount = 0,
  excluded = null,
  fallback = false,
  timings = null
}) {
  const base = {
    excluded: { stale: Number(excluded?.stale) || 0, otherWantsList: Number(excluded?.otherWantsList) || 0 },
    fallback: Boolean(fallback),
    timings,
    slow: Number(timings?.candidateMs) > SLOW_CANDIDATE_RUN_MS
  };
  if (!captures.length || !candidateResult) {
    return { ...base, state: "none" };
  }

  const offersChecked = stats?.received ?? captures.reduce((sum, capture) => sum + (capture.offers?.length || 0), 0);
  const breakdown = {
    inCart: stats?.beforeFilter ?? 0,
    otherCards: stats?.notInCart ?? 0,
    alreadyInCart: stats?.alreadyInCart ?? 0
  };
  const before = scoreOf(cartResult);
  const after = scoreOf(candidateResult);
  const sameResolution = after.unresolvedCount === before.unresolvedCount;
  const improved = candidateResult !== cartResult && (
    after.unresolvedCount < before.unresolvedCount ||
    (sameResolution && before.total - after.total > SAVINGS_EPSILON)
  );

  // Empty wants pages arrive as 0-offer captures: checked, nothing extra.
  const emptySellers = captures.filter((capture) => Array.isArray(capture.offers) && capture.offers.length === 0).length;
  const shared = { ...base, offersChecked, sellersChecked: captures.length, emptySellers, breakdown };
  if (!improved) {
    return { ...shared, state: "nothing-better", before: roundMoney(before.total) };
  }

  const adds = (candidateResult.selectedOffers || []).filter((offer) => offer.source === "candidate");
  const addSellers = new Set(adds.map((offer) => offer.sellerIndex));
  return {
    ...shared,
    state: "improved",
    // Only a like-for-like comparison yields a savings figure.
    savings: sameResolution ? roundMoney(before.total - after.total) : null,
    before: sameResolution ? roundMoney(before.total) : null,
    after: sameResolution ? roundMoney(after.total) : null,
    adds: {
      articles: adds.reduce((sum, offer) => sum + quantityOf(offer), 0),
      sellers: addSellers.size,
      newSellers: [...addSellers].filter((sellerIndex) => sellerIndex >= cartSellerCount).length
    },
    // Cart articles the cart-only plan keeps but the candidate plan drops.
    removals: droppedCartArticles(cartResult, candidateResult)
  };
}

// Text for the impact card and the review-step status line. `formatMoney` is the app's.
export function describeCandidateImpact(impact, formatMoney = (value) => `€${Number(value).toFixed(2)}`) {
  const lines = {
    headline: null,
    detail: "",
    ...captureNotes({ excluded: impact.excluded, fallback: impact.fallback && impact.state !== "none" }),
    slowLine: "",
    tip: ""
  };
  if (impact.slow) {
    lines.slowLine = `Comparing with the wants stock took ${(impact.timings.candidateMs / 1000).toFixed(1)} s.`;
  }

  if (impact.state === "none") {
    lines.tip = "Tip: load sellers' wants stock from your cart page to compare offers outside your cart.";
    return lines;
  }

  const checked = checkedText(impact);
  lines.detail = impact.offersChecked === 0 ? "" : `Of ${plural(impact.offersChecked, "offer")}: ${impact.breakdown.inCart} for cards in your cart, ${impact.breakdown.otherCards} for other wants-list cards (ignored), ${impact.breakdown.alreadyInCart} already in your cart.`;

  if (impact.state === "nothing-better") {
    lines.headline = { lead: `${checked} — `, strong: "nothing beats your cart", tail: ". Your plan uses only cart items." };
    return lines;
  }

  const { adds } = impact;
  const actions = ` Add ${plural(adds.articles, "article")} from ${plural(adds.sellers, "seller")} (${plural(adds.newSellers, "new seller")}), remove ${impact.removals}.`;
  lines.headline = impact.savings === null
    ? { lead: `${checked} → `, strong: "a plan with fewer sellers needing shipping review", tail: `.${actions}` }
    : { lead: `${checked} → `, strong: `saves ${formatMoney(impact.savings)}`, tail: ` (${formatMoney(impact.before)} → ${formatMoney(impact.after)}).${actions}` };
  return lines;
}

// "Checked 12 offers from 3 sellers", plus sellers whose wants page was empty:
// "…, 2 more checked, nothing extra" / "Checked 2 sellers, nothing extra".
export function checkedText({ offersChecked = 0, sellersChecked = 0, emptySellers = 0 }) {
  const withOffers = sellersChecked - emptySellers;
  if (!emptySellers) return `Checked ${plural(offersChecked, "offer")} from ${plural(sellersChecked, "seller")}`;
  if (!withOffers) return `Checked ${plural(emptySellers, "seller")}, nothing extra`;
  return `Checked ${plural(offersChecked, "offer")} from ${plural(withOffers, "seller")}, ${emptySellers} more checked, nothing extra`;
}

// Muted notes: captures the extension did not send, and the no-wants-list fallback.
export function captureNotes({ excluded = null, fallback = false } = {}) {
  const parts = [];
  if (excluded?.stale) parts.push(`${plural(excluded.stale, "capture")} older than 24 h`);
  if (excluded?.otherWantsList) parts.push(`${plural(excluded.otherWantsList, "capture")} from another wants list`);
  return {
    excludedLine: parts.length ? `Not used: ${parts.join(", ")}.` : "",
    fallbackLine: fallback
      ? "Your cart has no wants-list info (older extension or pasted cart), so every capture from the last 24 h was used."
      : ""
  };
}

export function headlineText(headline) {
  return headline ? `${headline.lead}${headline.strong}${headline.tail}` : "";
}

function scoreOf(result) {
  const unresolvedCount = Number.isFinite(result?.unresolvedCount) ? result.unresolvedCount : (result?.unresolvedSellers?.length || 0);
  const total = Number.isFinite(result?.resolvedTotal) ? result.resolvedTotal : Number(result?.selectedTotal);
  return { unresolvedCount, total };
}

function droppedCartArticles(cartResult, candidateResult) {
  const kept = (result) => {
    const byRow = new Map();
    (result?.selectedOffers || []).forEach((offer) => {
      if (offer.source === "candidate" || !Number.isInteger(offer.itemIndex)) return;
      const key = `${offer.sellerIndex}:${offer.itemIndex}`;
      byRow.set(key, (byRow.get(key) || 0) + quantityOf(offer));
    });
    return byRow;
  };
  const after = kept(candidateResult);
  let dropped = 0;
  kept(cartResult).forEach((quantity, key) => {
    dropped += Math.max(0, quantity - (after.get(key) || 0));
  });
  return dropped;
}

function quantityOf(offer) {
  return Number(offer.requiredQuantity || offer.quantity || 1);
}

function plural(count, word) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function roundMoney(value) {
  return Math.round(Number(value) * 100) / 100;
}
