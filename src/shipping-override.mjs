import { estimateShipmentWeight } from "./shipping.mjs";

/**
 * Returns a shipping cost result shaped like calculateShippingCost's output, but
 * using seller.shippingCostOverride as the fixed cost. Only call this when
 * seller.shippingCostOverride is a finite number (including 0 for free shipping).
 */
export function applyShippingOverride(seller, offers) {
  const quantity = offers.reduce((sum, o) => sum + Number(o.requiredQuantity || o.quantity || 1), 0);
  const overrideCost = seller.shippingCostOverride;
  return {
    ok: true,
    cost: overrideCost,
    basePrice: overrideCost,
    cardmarketFeeValue: 0,
    method: seller.shippingMethod || "Manual override",
    tracked: seller.trackingStatus === "tracked",
    isRegistered: false,
    country: seller.sellerCountry || "",
    cardCount: quantity,
    estimatedWeight: estimateShipmentWeight(offers.length),
    trackedRequired: false,
    eligibleCount: 1,
    candidateCount: 1,
    cardmarketFeeIncluded: false,
    reason: "Manual shipping cost override applied"
  };
}
