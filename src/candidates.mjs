// Offers captured from sellers' "Articles on My Wants List" pages (extension), turned
// into extra optimizer candidates. Pure: card and variant keys are injected so this
// module matches the app's grouping exactly.
//
// Demand stays the cart: a candidate is only used for a card that is already in the cart.
// A candidate seller already in the cart is the same seller (same sellerIndex, country
// and shipping calibration); any other seller is appended as a new seller entry.

const PRICE_EPSILON = 0.005;
export const MAX_CANDIDATES_PER_CARD_SELLER = 3;
export const CANDIDATE_STALE_MS = 24 * 60 * 60 * 1000;

export function normalizeSellerName(name) {
  return String(name || "").trim().toLowerCase();
}

export function isCandidateStale(capturedAt, now = Date.now()) {
  const time = Date.parse(capturedAt || "");
  return !Number.isFinite(time) || now - time > CANDIDATE_STALE_MS;
}

// cartSellers / offerGroups: the cart-only data (buildOfferGroups output).
// candidateSellers: [{ sellerName, sellerCountry, capturedAt, stale, offers: [...] }] from the extension.
// cardKey(name) → grouping key (the app's normalizeOfferKey); variantKey(offer) → variant key.
export function mergeCandidateOffers({
  cartSellers = [],
  offerGroups = [],
  candidateSellers = [],
  cardKey,
  variantKey,
  variantPreferences = {},
  maxPerCardSeller = MAX_CANDIDATES_PER_CARD_SELLER
}) {
  const stats = { received: 0, notInCart: 0, alreadyInCart: 0, excludedByPreference: 0, beforeFilter: 0, afterFilter: 0, newSellers: 0, staleSellers: 0 };
  const groupByKey = new Map(offerGroups.map((group) => [cardKey(group.cardName), group]));
  const sellers = [...cartSellers];
  const sellerIndexByName = new Map(cartSellers.map((seller, index) => [normalizeSellerName(seller.sellerName), index]));
  const candidatesByGroup = new Map(); // group → Map(sellerIndex → offers[])

  for (const capture of candidateSellers) {
    const nameKey = normalizeSellerName(capture.sellerName);
    if (!nameKey || !Array.isArray(capture.offers)) continue;
    if (capture.stale) stats.staleSellers += 1;

    let sellerIndex = sellerIndexByName.get(nameKey);
    if (sellerIndex === undefined) {
      sellerIndex = sellers.length;
      sellers.push(newCandidateSeller(capture));
      sellerIndexByName.set(nameKey, sellerIndex);
      stats.newSellers += 1;
    }
    const seller = sellers[sellerIndex];

    for (const captured of capture.offers) {
      stats.received += 1;
      const group = groupByKey.get(cardKey(captured.cardName));
      if (!group) {
        stats.notInCart += 1;
        continue;
      }
      // The wants page also lists articles that are already in the cart.
      if (seller.source !== "candidate" && isCartArticle(group, sellerIndex, captured)) {
        stats.alreadyInCart += 1;
        continue;
      }
      const offer = candidateOffer(captured, group, seller, sellerIndex, capture);
      if (!candidatesByGroup.has(group)) candidatesByGroup.set(group, new Map());
      const bySeller = candidatesByGroup.get(group);
      if (!bySeller.has(sellerIndex)) bySeller.set(sellerIndex, []);
      bySeller.get(sellerIndex).push(offer);
      stats.beforeFilter += 1;
    }
  }

  const mergedGroups = offerGroups.map((group) => {
    const bySeller = candidatesByGroup.get(group);
    const cartOffers = group.offers.map((offer) => (offer.source ? offer : { ...offer, source: "cart" }));
    if (!bySeller) return { ...group, offers: cartOffers, candidateCount: 0 };

    const kept = [];
    bySeller.forEach((offers) => {
      const filtered = prefilter(offers, variantPreferences[group.cardName] || {}, variantKey, maxPerCardSeller, stats);
      kept.push(...filtered);
    });
    stats.afterFilter += kept.length;
    const prices = [...cartOffers, ...kept].map((offer) => Number(offer.unitPrice)).filter(Number.isFinite);
    return {
      ...group,
      offers: [...cartOffers, ...kept],
      candidateCount: kept.length,
      lowestUnitPrice: prices.length ? Math.min(...prices) : group.lowestUnitPrice,
      highestUnitPrice: prices.length ? Math.max(...prices) : group.highestUnitPrice
    };
  });

  return { sellers, offerGroups: mergedGroups, stats };
}

// Per (card, seller): apply the user's variant preferences, keep the cheapest offer per
// variant, and at most `max` offers overall (cheapest first).
function prefilter(offers, prefs, variantKey, max, stats) {
  const hasRequire = Object.values(prefs).some((pref) => pref === "require");
  const allowed = offers.filter((offer) => {
    const pref = prefs[variantKey(offer)] || "any";
    const ok = pref !== "exclude" && (!hasRequire || pref === "require");
    if (!ok) stats.excludedByPreference += 1;
    return ok;
  });
  const cheapestByVariant = new Map();
  allowed.forEach((offer) => {
    const key = variantKey(offer);
    const best = cheapestByVariant.get(key);
    if (!best || offer.unitPrice < best.unitPrice) cheapestByVariant.set(key, offer);
  });
  return [...cheapestByVariant.values()].sort((a, b) => a.unitPrice - b.unitPrice).slice(0, max);
}

function isCartArticle(group, sellerIndex, captured) {
  return group.offers.some((offer) => (
    offer.sellerIndex === sellerIndex &&
    normalizeCondition(offer.condition) === normalizeCondition(captured.condition) &&
    Math.abs(Number(offer.unitPrice) - Number(captured.price)) <= PRICE_EPSILON
  ));
}

function normalizeCondition(value) {
  return String(value || "").trim().toLowerCase();
}

function candidateOffer(captured, group, seller, sellerIndex, capture) {
  return {
    sellerName: seller.sellerName,
    sellerId: "",
    sellerProfileUrl: "",
    shipmentId: "",
    sellerIndex,
    // Not a cart row: a string id keeps cost-cache keys unique and keeps cart-row
    // lookups (itemIndex into seller.items) from ever matching a candidate.
    itemIndex: `cand:${captured.idArticle}`,
    itemId: `cand-${captured.idArticle}`,
    articleId: String(captured.idArticle || ""),
    productId: "",
    productUrl: captured.productPath || "",
    cardName: captured.cardName || group.cardName,
    comparableCardName: group.cardName,
    setName: captured.expansion || "",
    expansion: captured.expansion || "",
    expansionId: "",
    collectorNumber: "",
    rarity: captured.rarity || "",
    rarityCode: "",
    condition: captured.condition || "",
    conditionCode: captured.conditionCode || "",
    language: captured.language || "",
    languageCode: "",
    foil: Boolean(captured.foil),
    comment: "",
    quantity: Math.max(1, Number(captured.available) || 1),
    unitPrice: Number(captured.price) || 0,
    sellerCountry: seller.sellerCountry,
    shippingMethod: seller.shippingMethod || "",
    tracked: seller.trackingStatus || "unknown",
    source: "candidate",
    wantsListId: String(captured.wantsListId || capture.wantsListId || ""),
    capturedAt: captured.capturedAt || capture.capturedAt || "",
    stale: Boolean(capture.stale)
  };
}

function newCandidateSeller(capture) {
  const country = String(capture.sellerCountry || "").trim();
  return {
    id: `candidate-${normalizeSellerName(capture.sellerName)}`,
    sellerId: "",
    sellerName: capture.sellerName,
    sellerProfileUrl: "",
    shipmentId: "",
    sellerType: "",
    shippingMethod: "",
    trackingStatus: "unknown",
    articleValue: null,
    shippingValue: null,
    trusteeValue: null,
    total: null,
    // Missing country → "Unknown", which the optimizer already treats as unresolved.
    sellerCountry: country || "Unknown",
    countrySource: country ? "capture" : "unknown",
    countryInference: { country: country || "Unknown", ambiguous: false, source: "capture" },
    observedShipping: null,
    // A manual fix from the unresolved-shipping form is stored on the capture entry.
    shippingCostOverride: Number.isFinite(capture.shippingCostOverride) ? capture.shippingCostOverride : null,
    items: [],
    rawText: "",
    source: "candidate",
    candidate: {
      wantsListId: String(capture.wantsListId || capture.offers?.[0]?.wantsListId || ""),
      capturedAt: capture.capturedAt || "",
      stale: Boolean(capture.stale)
    }
  };
}

// Result helper: chosen candidate offers, grouped per seller (for "Add to cart").
export function addOffersBySeller(selectedOffers = []) {
  const bySeller = new Map();
  selectedOffers.filter((offer) => offer.source === "candidate").forEach((offer) => {
    if (!bySeller.has(offer.sellerIndex)) bySeller.set(offer.sellerIndex, []);
    bySeller.get(offer.sellerIndex).push(offer);
  });
  return bySeller;
}

// "https://www.cardmarket.com/en/Magic/Users/<seller>/Offers/Singles?idWantslist=<id>"
export function wantsPageUrl(sellerName, wantsListId) {
  const base = `https://www.cardmarket.com/en/Magic/Users/${encodeURIComponent(sellerName)}/Offers/Singles`;
  return wantsListId ? `${base}?idWantslist=${encodeURIComponent(wantsListId)}` : base;
}
