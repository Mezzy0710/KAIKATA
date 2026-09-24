// What to cut from a seller's Cardmarket cart rows, given the optimized plan.
// Rows are matched by itemIndex (not card name), so two printings of one card at the
// same seller are told apart.

// offers: the plan's selected offers for this seller (carry itemIndex + requiredQuantity).
export function sellerCartCuts(seller, offers = []) {
  const keptByItem = new Map();
  offers.forEach((offer) => {
    if (!Number.isInteger(offer.itemIndex)) return;
    keptByItem.set(offer.itemIndex, (keptByItem.get(offer.itemIndex) || 0) + Number(offer.requiredQuantity || offer.quantity || 1));
  });

  const removeRows = [];
  const reduceRows = [];
  (seller?.items || []).forEach((item, itemIndex) => {
    const cartQty = Number(item.quantity || 1);
    const keepQty = keptByItem.get(itemIndex) || 0;
    if (!keepQty) {
      removeRows.push(cartRow(item));
    } else if (keepQty < cartQty) {
      reduceRows.push({ cardName: item.cardName || "", keepQty, cartQty });
    }
  });
  return { removeRows, reduceRows };
}

export function cartRow(item) {
  return {
    cardName: item.cardName || "",
    quantity: Number(item.quantity || 1),
    condition: item.condition || "",
    price: Number(item.price ?? item.unitPrice ?? 0)
  };
}
