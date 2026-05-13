/**
 * Build a confirmed buying plan from parsed cart and optimization result
 * @param {object} parsed - Parsed cart with sellers and items
 * @param {object} optimizationResult - Result from optimization algorithm
 * @returns {Promise<object>} Confirmed plan ready to execute
 */
export async function buildConfirmedPlan(parsed, optimizationResult) {
  if (!parsed || !optimizationResult) {
    throw new Error("Cannot build plan without parsed cart and optimization result");
  }

  const { sellers, itemCount } = parsed;
  const { selectedSellers, totalCost } = optimizationResult;

  // Build a buying plan grouped by seller
  const sellerPlans = selectedSellers.map(sellerIndex => {
    const seller = sellers[sellerIndex];
    return {
      sellerIndex,
      sellerName: seller.sellerName || `Seller ${sellerIndex + 1}`,
      items: seller.items || [],
      totalCost: seller.total
    };
  });

  return {
    parsed,
    optimizationResult,
    sellerPlans,
    totalCost,
    timestamp: new Date().toISOString()
  };
}
