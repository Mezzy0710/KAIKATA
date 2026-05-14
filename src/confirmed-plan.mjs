const CONFIRMED_PLAN_SCHEMA_VERSION = 1;

export async function buildConfirmedPlan(parsed, optimizationResult, options = {}) {
  const sellers = parsed?.sellers || [];
  const selectedOffers = optimizationResult?.selectedOffers || [];
  const usedSellerIndexes = new Set((optimizationResult?.usedSellers || []).map(({ sellerIndex }) => sellerIndex));
  const droppedSellerIndexes = new Set((optimizationResult?.droppedSellers || []).map(({ sellerIndex }) => sellerIndex));
  const countryWarningIndexes = new Set((optimizationResult?.countryWarnings || []).map(({ sellerIndex }) => sellerIndex));
  const sellerCostsByIndex = new Map((optimizationResult?.sellerCosts || []).map((cost) => [cost.sellerIndex, cost]));
  const selectedByRow = new Map(selectedOffers.map((offer) => [rowKey(offer.sellerIndex, offer.itemIndex), offer]));
  const canonicalCart = buildCanonicalCartSnapshot(parsed);
  const cartFingerprint = options.cartFingerprint || await createCartFingerprint(canonicalCart);
  const confirmedAt = options.confirmedAt || new Date().toISOString();
  const optimizationSessionId = options.optimizationSessionId || createOptimizationSessionId(cartFingerprint, confirmedAt);

  return {
    schemaVersion: CONFIRMED_PLAN_SCHEMA_VERSION,
    optimizationSessionId,
    importTimestamp: parsed?.extractedAt || options.importTimestamp || "",
    confirmedAt,
    source: parsed?.source || options.source || "",
    sourceUrl: parsed?.sourceUrl || options.sourceUrl || "",
    cartFingerprint,
    totals: buildTotals(optimizationResult),
    assumptions: {
      shipping: "Shipping is based on the selected CartForge shipping model and preserved seller/cart data.",
      trustee: "Trustee fees are based on parsed exact values when available, otherwise CartForge estimates."
    },
    sellers: sellers.map((seller, sellerIndex) => {
      const sellerCost = sellerCostsByIndex.get(sellerIndex);
      const needsReview = countryWarningIndexes.has(sellerIndex) || sellerCost?.source === "unresolved";
      const decision = needsReview
        ? "manual_review"
        : usedSellerIndexes.has(sellerIndex)
          ? "keep"
          : droppedSellerIndexes.has(sellerIndex)
            ? "drop"
            : "drop";

      return {
        sellerId: seller.sellerId || "",
        sellerIndex,
        sellerDisplayName: seller.sellerName || `Seller ${sellerIndex + 1}`,
        sellerProfileUrl: seller.sellerProfileUrl || "",
        shipmentId: seller.shipmentId || "",
        decision,
        reason: sellerDecisionReason(decision),
        selectedShippingMethod: sellerCost?.shippingMethod || seller.shippingMethod || "",
        shippingAssumption: {
          country: seller.sellerCountry || "Unknown",
          method: sellerCost?.shippingMethod || seller.shippingMethod || "",
          trackingStatus: sellerCost?.trackingStatus || seller.trackingStatus || "unknown",
          value: finiteNumberOrNull(sellerCost?.shippingValue)
        },
        trusteeAssumption: {
          value: finiteNumberOrNull(sellerCost?.trusteeFeeValue),
          source: sellerCost?.trusteeSource || "",
          label: sellerCost?.trusteeSourceLabel || ""
        },
        matchConfidence: sellerMatchConfidence(seller)
      };
    }),
    rows: sellers.flatMap((seller, sellerIndex) => {
      return (seller.items || []).map((item, itemIndex) => {
        const selectedOffer = selectedByRow.get(rowKey(sellerIndex, itemIndex));
        const hasWarnings = Array.isArray(item.warnings) && item.warnings.length > 0;
        const decision = hasWarnings
          ? "manual_review"
          : selectedOffer
            ? "selected"
            : "rejected";

        return {
          rowId: item.id || "",
          sellerId: seller.sellerId || "",
          sellerIndex,
          itemIndex,
          articleId: item.articleId || "",
          productId: item.productId || "",
          productUrl: item.productUrl || "",
          cardName: item.cardName || "",
          normalizedCardName: normalizePlanKey(item.cardName),
          setName: item.setName || "",
          expansionId: item.expansionId || "",
          collectorNumber: item.collectorNumber || "",
          rarity: item.rarity || "",
          rarityCode: item.rarityCode || "",
          language: item.language || "",
          languageCode: item.languageCode || "",
          condition: item.condition || "",
          conditionCode: item.conditionCode || "",
          quantity: Number(item.quantity || 1),
          selectedQuantity: selectedOffer ? Number(selectedOffer.requiredQuantity || selectedOffer.quantity || item.quantity || 1) : 0,
          unitPrice: Number(item.price || 0),
          decision,
          reason: rowDecisionReason(decision),
          matchConfidence: rowMatchConfidence(item, seller),
          comment: item.comment || ""
        };
      });
    })
  };
}

export function buildCanonicalCartSnapshot(parsed) {
  const sellers = (parsed?.sellers || []).map((seller, sellerIndex) => ({
    sellerId: seller.sellerId || "",
    sellerIndex,
    sellerDisplayName: seller.sellerName || "",
    sellerProfileUrl: seller.sellerProfileUrl || "",
    shipmentId: seller.shipmentId || "",
    shippingMethod: seller.shippingMethod || "",
    trackingStatus: seller.trackingStatus || "",
    sellerCountry: seller.sellerCountry || "",
    rows: (seller.items || []).map((item, itemIndex) => ({
      rowId: item.id || "",
      itemIndex,
      articleId: item.articleId || "",
      productId: item.productId || "",
      productUrl: item.productUrl || "",
      cardName: item.cardName || "",
      normalizedCardName: normalizePlanKey(item.cardName),
      setName: item.setName || "",
      expansionId: item.expansionId || "",
      collectorNumber: item.collectorNumber || "",
      language: item.language || "",
      languageCode: item.languageCode || "",
      condition: item.condition || "",
      conditionCode: item.conditionCode || "",
      quantity: Number(item.quantity || 1),
      unitPrice: Number(item.price || 0),
      comment: item.comment || ""
    }))
  }));

  return { schemaVersion: CONFIRMED_PLAN_SCHEMA_VERSION, sellers };
}

export async function createCartFingerprint(canonicalCart) {
  const canonicalJson = stableStringify(canonicalCart);
  return `sha256:${await hashString(canonicalJson)}`;
}

export function stableStringify(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

export function normalizePlanKey(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildTotals(result) {
  return {
    originalTotal: finiteNumberOrNull(result?.currentTotal),
    selectedTotal: finiteNumberOrNull(result?.selectedTotal),
    cardTotal: finiteNumberOrNull(result?.cardTotal),
    shippingTotal: finiteNumberOrNull(result?.shippingTotal),
    trusteeTotal: finiteNumberOrNull(result?.trusteeTotal),
    fixedTotal: finiteNumberOrNull(result?.fixedTotal),
    savings: finiteNumberOrNull(result?.savings)
  };
}

function sellerDecisionReason(decision) {
  if (decision === "keep") return "Selected for lowest combined cart cost.";
  if (decision === "manual_review") return "Review seller country, shipping, or fee assumptions before following this guidance.";
  return "No optimized rows selected for this seller.";
}

function rowDecisionReason(decision) {
  if (decision === "selected") return "Buy here.";
  if (decision === "manual_review") return "Review this row before following the overlay.";
  return "Not selected in the optimized plan.";
}

function sellerMatchConfidence(seller) {
  if (seller?.sellerId && seller?.sellerProfileUrl) return "high";
  if (seller?.sellerId || seller?.sellerName) return "medium";
  return "low";
}

function rowMatchConfidence(item, seller) {
  if (item?.articleId && item?.productId && seller?.sellerId) return "high";
  if (item?.articleId || (item?.productId && seller?.sellerName)) return "medium";
  return "low";
}

function rowKey(sellerIndex, itemIndex) {
  return `${sellerIndex}:${itemIndex}`;
}

function finiteNumberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function createOptimizationSessionId(cartFingerprint, confirmedAt) {
  return `cf_${hashStringFallback(`${cartFingerprint}|${confirmedAt}`).slice(0, 16)}`;
}

async function hashString(value) {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.subtle && typeof TextEncoder !== "undefined") {
    const bytes = new TextEncoder().encode(value);
    const digest = await cryptoApi.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  return hashStringFallback(value);
}

function hashStringFallback(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}