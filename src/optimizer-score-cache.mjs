// Memoizes per-seller cost during one optimization run. A local-search move only
// changes the offers of one or two sellers, so almost every seller's cost in a trial
// has been computed before. Create one cache per run so edited seller data (country,
// shipping override, …) can never be served stale.
export function createSellerCostCache(estimateSellerCost) {
  const cache = new Map();
  return (sellerIndex, offers) => {
    const key = `${sellerIndex}|${offers
      .map((offer) => `${offer.sellerIndex}:${offer.itemIndex}:${offer.requiredQuantity}`)
      .sort()
      .join(",")}`;
    let cost = cache.get(key);
    if (!cost) {
      cost = estimateSellerCost(sellerIndex, offers);
      cache.set(key, cost);
    }
    return cost;
  };
}
