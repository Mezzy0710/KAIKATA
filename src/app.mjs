import { COUNTRY_OPTIONS, buildShippingIndex, formatMoney, parseCart, parseMoney } from "./parser.mjs?v=20260508g";
import { calculateShippingCost, estimateShipmentWeight, SHIPPING_DATA_INCLUDES_CARDMARKET_FEE } from "./shipping.mjs?v=20260508g";

const manaClasses = ["mana-w", "mana-u", "mana-b", "mana-r", "mana-g"];
const conditionOptions = ["Unknown", "Near Mint", "Mint", "Excellent", "Good", "Light Played", "Played", "Poor"];
const MAX_OPTIMIZATION_ITERATIONS = 50;

const state = {
  shippingData: null,
  parsed: parseCart(""),
  showDebug: true,
  desiredQuantityByCard: {},
  optimizationStale: false
};

const elements = {
  cartInput: document.querySelector("#cartInput"),
  parseButton: document.querySelector("#parseButton"),
  loadSampleButton: document.querySelector("#loadSampleButton"),
  clearButton: document.querySelector("#clearButton"),
  debugToggle: document.querySelector("#debugToggle"),
  runOptimizationButton: document.querySelector("#runOptimizationButton"),
  desiredCardsReview: document.querySelector("#desiredCardsReview"),
  sellerReview: document.querySelector("#sellerReview"),
  summaryStrip: document.querySelector("#summaryStrip"),
  sellerCount: document.querySelector("#sellerCount"),
  itemCount: document.querySelector("#itemCount"),
  parsedTotal: document.querySelector("#parsedTotal"),
  parseMessage: document.querySelector("#parseMessage"),
  shippingDataState: document.querySelector("#shippingDataState"),
  optimizationState: document.querySelector("#optimizationState"),
  optimizationOutput: document.querySelector("#optimizationOutput"),
  emptyStateTemplate: document.querySelector("#emptyStateTemplate")
};

boot();

function boot() {
  elements.parseButton.addEventListener("click", parseCurrentInput);
  elements.loadSampleButton.addEventListener("click", loadSampleCart);
  elements.clearButton.addEventListener("click", clearInput);
  elements.debugToggle.addEventListener("change", () => {
    state.showDebug = elements.debugToggle.checked;
    render();
  });
  elements.runOptimizationButton.addEventListener("click", runOptimizationPlaceholder);
  elements.desiredCardsReview.addEventListener("change", handleDesiredQuantityChange);
  elements.desiredCardsReview.addEventListener("click", handleDesiredQuantityClick);
  elements.sellerReview.addEventListener("change", handleReviewChange);
  elements.sellerReview.addEventListener("click", handleReviewClick);
  elements.optimizationOutput.addEventListener("change", handleReviewChange);

  loadShippingData();
  render();
}

async function loadShippingData() {
  try {
    const response = await fetch("./shipping_data.json", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    state.shippingData = await response.json();
    elements.shippingDataState.textContent = "Shipping data loaded";
    elements.shippingDataState.className = "status-pill good";
  } catch (error) {
    state.shippingData = null;
    elements.shippingDataState.textContent = window.location.protocol === "file:" ? "Use localhost for shipping data" : "Shipping data missing";
    elements.shippingDataState.className = "status-pill warning";
  }
}

async function loadSampleCart() {
  try {
    const response = await fetch("./sample-cart-mobile.txt", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    elements.cartInput.value = await response.text();
    parseCurrentInput();
  } catch (error) {
    setMessage("Could not load sample-cart-mobile.txt from this static directory.");
  }
}

function parseCurrentInput() {
  state.parsed = parseCart(elements.cartInput.value, state.shippingData);
  state.optimizationStale = true;
  const warningText = state.parsed.warnings.length ? ` ${state.parsed.warnings.join(" ")}` : "";
  const offerGroups = buildOfferGroups(state.parsed.sellers);

  state.desiredQuantityByCard = {};
  offerGroups.forEach((group) => {
    state.desiredQuantityByCard[group.cardName] = group.requiredQuantity;
  });

  setMessage(`Parsed ${state.parsed.sellerCount} seller block(s), ${state.parsed.itemCount} seller offer(s), and ${offerGroups.length} card group(s).${warningText}`);
  elements.optimizationState.textContent = "Ready";
  elements.optimizationState.className = "status-pill info";
  elements.optimizationOutput.innerHTML = `<p class="result-empty">Review desired quantities, adjust if needed, then run optimization.</p>`;
  render();
}

function clearInput() {
  elements.cartInput.value = "";
  state.parsed = parseCart("");
  state.desiredQuantityByCard = {};
  state.optimizationStale = false;
  elements.optimizationState.textContent = "Waiting";
  elements.optimizationState.className = "status-pill muted";
  elements.optimizationOutput.innerHTML = `<p class="result-empty">Parse a cart, review desired quantities, then run optimization to see which sellers to keep.</p>`;
  setMessage("No cart parsed yet.");
  render();
}

function render() {
  const sellers = state.parsed.sellers || [];
  const itemCount = sellers.reduce((sum, seller) => sum + seller.items.length, 0);
  const offerGroups = buildOfferGroups(sellers);
  const parsedTotal = sellers.reduce((sum, seller) => sum + Number(seller.total || 0), 0);

  elements.sellerCount.textContent = String(sellers.length);
  elements.itemCount.textContent = String(itemCount);
  elements.parsedTotal.textContent = formatMoney(parsedTotal);

  renderSummary(sellers, itemCount, offerGroups, parsedTotal);
  renderDesiredCards(offerGroups);
  renderSellers(sellers, offerGroups);
}

function renderSummary(sellers, itemCount, offerGroups, parsedTotal) {
  const ambiguousCount = sellers.filter((seller) => seller.countryInference?.ambiguous).length;
  const unknownCountryCount = sellers.filter((seller) => !seller.sellerCountry || seller.sellerCountry === "Unknown").length;
  const trusteeTotal = sellers.reduce((sum, seller) => sum + Number(seller.trusteeValue || 0), 0);
  const shippingTotal = sellers.reduce((sum, seller) => sum + Number(seller.shippingValue || 0), 0);
  const competitiveCards = offerGroups.filter((group) => group.sellerCount > 1).length;

  elements.summaryStrip.innerHTML = [
    summaryCard("Sellers", sellers.length),
    summaryCard("Card groups", offerGroups.length),
    summaryCard("Seller offers", itemCount),
    summaryCard("Competitive cards", competitiveCards),
    summaryCard("Fixed costs", formatMoney(shippingTotal + trusteeTotal)),
    summaryCard("Needs country review", ambiguousCount + unknownCountryCount)
  ].join("");
}

function summaryCard(label, value) {
  return `<div class="summary-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function renderDesiredCards(offerGroups) {
  elements.desiredCardsReview.innerHTML = "";

  if (!offerGroups.length) {
    return;
  }

  const detectedTotal = Object.values(state.desiredQuantityByCard).reduce((sum, qty) => sum + qty, 0);
  const selectedTotal = Object.values(state.desiredQuantityByCard).filter(qty => qty > 0).length;

  elements.desiredCardsReview.insertAdjacentHTML("beforeend", `
    <details class="review-details desired-cards-section" open>
      <summary>
        <span>Review desired cards</span>
        <span class="summary-meta">${selectedTotal} card group(s) · ${detectedTotal} cards selected</span>
      </summary>
      <div class="review-details-body">
        <p class="note-text">Quantities are inferred from the pasted cart. Adjust them before optimizing if needed.</p>
        ${desiredCardsTableTemplate(offerGroups)}
      </div>
    </details>
  `);
}

function desiredCardsTableTemplate(offerGroups) {
  return `
    <section class="panel desired-cards-panel">
      <div class="desired-cards-wrap">
        <table class="desired-cards-table">
          <thead>
            <tr>
              <th>Card</th>
              <th>Desired qty</th>
              <th>Offers found</th>
              <th>Best price</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${offerGroups.map(desiredCardRowTemplate).join("")}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function desiredCardRowTemplate(group) {
  const desiredQty = state.desiredQuantityByCard[group.cardName] || group.requiredQuantity;
  const availableQty = Math.max(...group.offers.map(o => o.quantity), 0);
  const isAvailable = availableQty >= desiredQty;
  const statusLabel = desiredQty === 0 ? "Excluded" : isAvailable ? "Ready" : "Insufficient";
  const statusClass = desiredQty === 0 ? "muted" : isAvailable ? "good" : "warning";

  return `
    <tr data-card-name="${escapeAttribute(group.cardName)}">
      <td>${escapeHtml(group.cardName)}</td>
      <td class="qty-cell">
        <button class="qty-button" data-action="decrement-qty" title="Decrease quantity" aria-label="Decrease ${group.cardName} quantity">−</button>
        <input class="qty-input" type="number" data-card-qty min="0" step="1" value="${desiredQty}" aria-label="Desired quantity for ${group.cardName}">
        <button class="qty-button" data-action="increment-qty" title="Increase quantity" aria-label="Increase ${group.cardName} quantity">+</button>
      </td>
      <td>${escapeHtml(group.sellerCount)}</td>
      <td>${escapeHtml(formatMoney(group.lowestUnitPrice))}</td>
      <td><span class="status-pill ${statusClass}">${escapeHtml(statusLabel)}</span></td>
    </tr>
  `;
}

function renderSellers(sellers, offerGroups) {
  elements.sellerReview.innerHTML = "";

  if (!sellers.length) {
    elements.sellerReview.append(elements.emptyStateTemplate.content.cloneNode(true));
    return;
  }

  elements.sellerReview.insertAdjacentHTML("beforeend", `
    <details class="review-details">
      <summary>Review parsed seller costs and card offers</summary>
      <div class="review-details-body">
        ${sellerSummaryTableTemplate(sellers)}
        ${offerMatrixTemplate(offerGroups)}
      </div>
    </details>
  `);

  const sellerCards = sellers.map((seller, sellerIndex) => `
    <article class="seller-card ${manaClasses[sellerIndex % manaClasses.length]}" data-seller-index="${sellerIndex}">
      ${sellerItemBreakdownTemplate(seller, sellerIndex)}
    </article>
  `).join("");

  elements.sellerReview.insertAdjacentHTML("beforeend", `
    <details class="review-details">
      <summary>Raw per-seller item breakdown</summary>
      <div class="seller-card-list">${sellerCards}</div>
    </details>
  `);
}

function offerMatrixTemplate(offerGroups) {
  return `
    <section class="panel offer-matrix-panel">
      <div class="panel-heading">
        <h2>Card Offer Matrix</h2>
        <span class="status-pill muted">Optimizer input</span>
      </div>
      <div class="offer-matrix-wrap">
        <table class="offer-matrix-table">
          <thead>
            <tr>
              <th>Required card</th>
              <th>Review qty</th>
              <th>Seller options</th>
              <th>Lowest unit</th>
              <th>Offers</th>
            </tr>
          </thead>
          <tbody>
            ${offerGroups.map(offerGroupRowTemplate).join("")}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function offerGroupRowTemplate(group) {
  return `
    <tr>
      <td>${escapeHtml(group.cardName)}</td>
      <td>${escapeHtml(group.requiredQuantity)}</td>
      <td>${escapeHtml(group.sellerCount)}</td>
      <td>${escapeHtml(formatMoney(group.lowestUnitPrice))}</td>
      <td>
        <div class="offer-chip-list">
          ${group.offers.map((offer) => `
            <span class="offer-chip">${escapeHtml(offer.sellerName)}: ${escapeHtml(offer.quantity)}x ${escapeHtml(offer.condition)} @ ${escapeHtml(formatMoney(offer.unitPrice))}</span>
          `).join("")}
        </div>
      </td>
    </tr>
  `;
}

function sellerSummaryTableTemplate(sellers) {
  return `
    <section class="panel review-table-panel">
      <div class="panel-heading">
        <h2>Seller Review Table</h2>
        <span class="status-pill muted">Editable</span>
      </div>
      <div class="seller-summary-wrap">
        <table class="seller-summary-table">
          <thead>
            <tr>
              <th>Seller name</th>
              <th>Inferred country</th>
              <th>Shipping method</th>
              <th>Tracked</th>
              <th>Article value</th>
              <th>Shipping cost</th>
              <th>Trustee cost</th>
              <th>Total</th>
              <th>Ambiguity warning</th>
            </tr>
          </thead>
          <tbody>
            ${sellers.map((seller, sellerIndex) => sellerSummaryRowTemplate(seller, sellerIndex)).join("")}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function sellerSummaryRowTemplate(seller, sellerIndex) {
  const inference = seller.countryInference || {};
  const inferenceLabel = seller.countrySource === "explicit"
    ? "Explicit country"
    : inference.ambiguous
      ? "Ambiguous shipping"
      : inference.country
        ? "Inferred country"
        : "Country review";
  const inferenceClass = inference.ambiguous || !seller.sellerCountry || seller.sellerCountry === "Unknown" ? "warning" : "good";
  const warning = inference.ambiguous
    ? "Multiple country matches"
    : !seller.sellerCountry || seller.sellerCountry === "Unknown"
      ? "Country unknown"
      : "";

  return `
    <tr data-seller-index="${sellerIndex}">
      <td><input data-field="sellerName" value="${escapeAttribute(seller.sellerName)}" aria-label="Seller name"></td>
      <td>${selectFieldTemplate("", "sellerCountry", seller.sellerCountry || "Unknown", countryOptions())}</td>
      <td><input data-field="shippingMethod" value="${escapeAttribute(seller.shippingMethod)}" aria-label="Shipping method"></td>
      <td>${selectFieldTemplate("", "trackingStatus", seller.trackingStatus || "unknown", ["unknown", "tracked", "untracked"])}</td>
      <td><input data-field="articleValue" value="${escapeAttribute(moneyInputValue(seller.articleValue))}" aria-label="Article value"></td>
      <td><input data-field="shippingValue" value="${escapeAttribute(moneyInputValue(seller.shippingValue))}" aria-label="Shipping cost"></td>
      <td><input data-field="trusteeValue" value="${escapeAttribute(moneyInputValue(seller.trusteeValue))}" aria-label="Trustee cost"></td>
      <td><input data-field="total" value="${escapeAttribute(moneyInputValue(seller.total))}" aria-label="Total"></td>
      <td><span class="status-pill ${inferenceClass}">${escapeHtml(warning || inferenceLabel)}</span></td>
    </tr>
  `;
}

function sellerItemBreakdownTemplate(seller, sellerIndex) {
  const inference = seller.countryInference || {};
  const inferenceLabel = seller.countrySource === "explicit"
    ? "Explicit country"
    : inference.ambiguous
      ? "Ambiguous shipping"
      : inference.country
        ? "Inferred country"
        : "Country review";
  const inferenceClass = inference.ambiguous || !seller.sellerCountry || seller.sellerCountry === "Unknown" ? "warning" : "good";

  return `
    <div class="seller-header">
      <div class="seller-title">
        <span class="eyebrow">Seller ${sellerIndex + 1}</span>
        <h3>${escapeHtml(seller.sellerName)}</h3>
      </div>
      <div class="seller-chips">
        <span class="status-pill ${inferenceClass}">${escapeHtml(inferenceLabel)}</span>
        <span class="status-pill info">${escapeHtml(seller.trackingStatus || "unknown")}</span>
        <span class="status-pill muted">${seller.items.length} item(s)</span>
      </div>
    </div>
    ${matchPanelTemplate(seller)}
    <div class="table-toolbar">
      <h3>Item Rows</h3>
      <button class="ghost-button" type="button" data-action="add-item">Add Row</button>
    </div>
    <div class="item-table-wrap">
      <table class="item-table">
        <thead>
          <tr>
            <th>Card</th>
            <th class="condition-cell">Condition</th>
            <th class="qty-cell">Qty</th>
            <th class="price-cell">Price</th>
            <th>Seller</th>
            <th>Raw</th>
            <th class="actions-cell"></th>
          </tr>
        </thead>
        <tbody>
          ${seller.items.map((item, itemIndex) => itemRowTemplate(item, itemIndex, seller.sellerName)).join("")}
        </tbody>
      </table>
    </div>
    <pre class="raw-block ${state.showDebug ? "" : "hidden"}">${escapeHtml(seller.rawText)}</pre>
  `;
}

function fieldTemplate(label, field, value) {
  return `
    <label class="field">
      <span>${escapeHtml(label)}</span>
      <input data-field="${escapeAttribute(field)}" value="${escapeAttribute(value ?? "")}">
    </label>
  `;
}

function selectFieldTemplate(label, field, value, options) {
  return `
    <label class="field">
      ${label ? `<span>${escapeHtml(label)}</span>` : ""}
      <select data-field="${escapeAttribute(field)}">
        ${options.map((option) => `<option value="${escapeAttribute(option)}" ${option === value ? "selected" : ""}>${escapeHtml(option)}</option>`).join("")}
      </select>
    </label>
  `;
}

function matchPanelTemplate(seller) {
  const matches = seller.countryInference?.matches || [];
  if (!matches.length) {
    return "";
  }

  return `
    <div class="match-panel">
      <h3>Shipping Matches</h3>
      <div class="match-list">
        ${matches.map((match) => `
          <button class="match-button" type="button" data-action="apply-match" data-country="${escapeAttribute(match.country)}" data-method="${escapeAttribute(match.method)}">
            ${escapeHtml(match.country)} / ${escapeHtml(match.method || "Method")} (${Math.round(match.score * 100)}%)
          </button>
        `).join("")}
      </div>
    </div>
  `;
}

function itemRowTemplate(item, itemIndex, sellerName) {
  return `
    <tr data-item-index="${itemIndex}">
      <td><input data-item-field="cardName" value="${escapeAttribute(item.cardName)}" aria-label="Card name"></td>
      <td class="condition-cell">
        <select data-item-field="condition" aria-label="Condition">
          ${conditionOptions.map((option) => `<option value="${escapeAttribute(option)}" ${option === item.condition ? "selected" : ""}>${escapeHtml(option)}</option>`).join("")}
        </select>
      </td>
      <td class="qty-cell"><input data-item-field="quantity" type="number" min="1" step="1" value="${escapeAttribute(item.quantity)}" aria-label="Quantity"></td>
      <td class="price-cell"><input data-item-field="price" value="${escapeAttribute(moneyInputValue(item.price))}" aria-label="Price"></td>
      <td><input value="${escapeAttribute(sellerName || "")}" aria-label="Seller" disabled></td>
      <td><input data-item-field="rawLine" value="${escapeAttribute(item.rawLine || "")}" aria-label="Raw row"></td>
      <td class="actions-cell"><button class="icon-button" type="button" data-action="delete-item" title="Delete row" aria-label="Delete row">x</button></td>
    </tr>
  `;
}

function handleReviewChange(event) {
  const sellerScope = event.target.closest("[data-seller-index]");
  if (!sellerScope) {
    return;
  }

  const sellerIndex = Number.parseInt(sellerScope.dataset.sellerIndex, 10);
  const seller = state.parsed.sellers[sellerIndex];
  const itemRow = event.target.closest("[data-item-index]");

  if (itemRow && event.target.dataset.itemField) {
    const itemIndex = Number.parseInt(itemRow.dataset.itemIndex, 10);
    const item = seller.items[itemIndex];
    const field = event.target.dataset.itemField;
    item[field] = coerceItemField(field, event.target.value);
    updateOptimizationPreview();
    return;
  }

  if (event.target.dataset.field) {
    const field = event.target.dataset.field;
    const value = coerceSellerField(field, event.target.value);
    seller[field] = value;

    if (field === "sellerCountry" && value && value !== "Unknown") {
      seller.countrySource = "manual";
      seller.countryInference = {
        ...seller.countryInference,
        ambiguous: false,
        country: value,
        source: "manual"
      };
    }

    if (field === "shippingMethod") {
      seller.shippingMethodSource = "manual";
    }

    if (field === "trackingStatus") {
      seller.trackingSource = "manual";
    }

    updateOptimizationPreview();
  }
}

function handleReviewClick(event) {
  const sellerScope = event.target.closest("[data-seller-index]");
  if (!sellerScope) {
    return;
  }

  const sellerIndex = Number.parseInt(sellerScope.dataset.sellerIndex, 10);
  const seller = state.parsed.sellers[sellerIndex];
  const action = event.target.dataset.action;

  if (action === "add-item") {
    seller.items.push({
      id: `manual-${Date.now()}`,
      cardName: "New card",
      condition: "Unknown",
      quantity: 1,
      price: 0,
      rawLine: "",
      warnings: ["Manual row"]
    });
    render();
    return;
  }

  if (action === "delete-item") {
    const row = event.target.closest("[data-item-index]");
    const itemIndex = Number.parseInt(row.dataset.itemIndex, 10);
    seller.items.splice(itemIndex, 1);
    render();
    return;
  }

  if (action === "apply-match") {
    seller.sellerCountry = event.target.dataset.country || "Unknown";
    seller.shippingMethod = event.target.dataset.method || seller.shippingMethod;
    seller.countrySource = "manual";
    seller.shippingMethodSource = "manual";
    render();
  }
}

function handleDesiredQuantityChange(event) {
  if (event.target.dataset.cardQty !== undefined) {
    const row = event.target.closest("[data-card-name]");
    if (!row) return;
    const cardName = row.dataset.cardName;
    const value = Math.max(0, Number.parseInt(event.target.value, 10) || 0);
    state.desiredQuantityByCard[cardName] = value;
    state.optimizationStale = true;
    updateOptimizationPreview();
  }
}

function handleDesiredQuantityClick(event) {
  const row = event.target.closest("[data-card-name]");
  if (!row) return;

  const cardName = row.dataset.cardName;
  const action = event.target.dataset.action;
  const input = row.querySelector("[data-card-qty]");

  if (action === "increment-qty") {
    const current = state.desiredQuantityByCard[cardName] || 0;
    state.desiredQuantityByCard[cardName] = current + 1;
    state.optimizationStale = true;
    input.value = state.desiredQuantityByCard[cardName];
    updateOptimizationPreview();
  } else if (action === "decrement-qty") {
    const current = state.desiredQuantityByCard[cardName] || 0;
    state.desiredQuantityByCard[cardName] = Math.max(0, current - 1);
    state.optimizationStale = true;
    input.value = state.desiredQuantityByCard[cardName];
    updateOptimizationPreview();
  }
}

function runOptimizationPlaceholder() {
  const sellers = state.parsed.sellers || [];
  const offerGroups = buildOfferGroups(sellers);

  if (!sellers.length || !offerGroups.length) {
    elements.optimizationState.textContent = "No data";
    elements.optimizationState.className = "status-pill warning";
    elements.optimizationOutput.innerHTML = `<p class="result-empty">Paste a cart and parse it before running optimization.</p>`;
    return;
  }

  state.optimizationStale = false;
  const result = optimizeCart(sellers, offerGroups);
  elements.optimizationState.textContent = result.statusLabel;
  elements.optimizationState.className = result.warnings.length ? "status-pill warning" : "status-pill good";
  elements.optimizationOutput.innerHTML = optimizationResultTemplate(result);
  elements.optimizationOutput.scrollIntoView({ behavior: "smooth", block: "start" });
}

function updateOptimizationPreview() {
  elements.optimizationState.textContent = "Needs update";
  elements.optimizationState.className = "status-pill warning";
  elements.optimizationOutput.innerHTML = `
    <div class="result-stale-notice">
      <p><strong>Buying plan needs update</strong></p>
      <p>You changed desired quantities after the last optimization.</p>
      <button id="rerunOptimizationButton" class="primary-button" type="button">Re-run optimization</button>
    </div>
  `;
  const sellers = state.parsed.sellers;
  renderSummary(sellers, state.parsed.itemCount, buildOfferGroups(sellers), sellers.reduce((sum, seller) => sum + Number(seller.total || 0), 0));

  document.getElementById("rerunOptimizationButton")?.addEventListener("click", runOptimizationPlaceholder);
}

function optimizeCart(sellers, offerGroups) {
  const shippingRecords = buildShippingIndex(state.shippingData);
  const groups = offerGroups.map((group) => {
    const desiredQty = state.desiredQuantityByCard[group.cardName] ?? group.requiredQuantity;
    if (desiredQty === 0) {
      return {
        ...group,
        requiredQuantity: 0,
        desiredQuantity: 0,
        candidates: []
      };
    }
    const validOffers = group.offers.filter((offer) => offer.quantity >= desiredQty);
    return {
      ...group,
      requiredQuantity: desiredQty,
      desiredQuantity: desiredQty,
      candidates: (validOffers.length ? validOffers : group.offers)
        .map((offer) => ({ ...offer, requiredQuantity: desiredQty }))
        .sort((a, b) => a.unitPrice - b.unitPrice)
    };
  });
  const warnings = [];
  const costNotes = [];
  const insufficientGroups = groups.filter((group) => group.desiredQuantity > 0 && !group.offers.some((offer) => offer.quantity >= group.desiredQuantity));
  const incompleteGroups = groups.filter((group) => !group.offers.some((offer) => offer.quantity >= group.requiredQuantity));
  const initialOffers = buildInitialAssignment(groups, sellers, shippingRecords);
  const optimization = optimizeBySellerMoves(initialOffers, groups, sellers, shippingRecords);
  const selectedOffers = optimization.selectedOffers;
  const score = optimization.score;
  const currentTotal = estimateCurrentTotal(sellers);
  const savings = currentTotal - score.total;
  const usedSellerIndexes = new Set(selectedOffers.map((offer) => offer.sellerIndex));
  const usedSellers = sellers
    .map((seller, sellerIndex) => ({ seller, sellerIndex }))
    .filter((entry) => usedSellerIndexes.has(entry.sellerIndex));
  const droppedSellers = sellers
    .map((seller, sellerIndex) => ({ seller, sellerIndex }))
    .filter((entry) => !usedSellerIndexes.has(entry.sellerIndex) && entry.seller.items.length);
  const countryWarnings = usedSellers.filter(({ seller }) => {
    const hasManualCountry = seller.countrySource === "manual" && seller.sellerCountry && seller.sellerCountry !== "Unknown";
    return !hasManualCountry && (!seller.sellerCountry || seller.sellerCountry === "Unknown" || seller.countryInference?.ambiguous);
  });
  const unresolvedShippingCosts = score.sellerCosts.filter((cost) => !Number.isFinite(cost.totalCost));

  if (insufficientGroups.length) {
    insufficientGroups.forEach((group) => {
      const maxAvailable = Math.max(...group.offers.map(o => o.quantity));
      warnings.push(`⚠️ ${group.cardName}: only ${maxAvailable} available, but desired quantity is ${group.desiredQuantity}.`);
    });
  }

  if (!shippingRecords.length) {
    costNotes.push("Shipping table unavailable: optimization cannot price dynamic shipping.");
  }

  if (incompleteGroups.length) {
    costNotes.push(`${incompleteGroups.length} card group(s) had no single seller offer with the full quantity.`);
  }

  if (countryWarnings.length) {
    costNotes.push(`${countryWarnings.length} selected seller(s) still need country/shipping review.`);
  }

  if (unresolvedShippingCosts.length) {
    costNotes.push(`${unresolvedShippingCosts.length} selected seller(s) have no valid dynamic shipping row. Review country and shipping data.`);
  }

  if (optimization.iterations >= MAX_OPTIMIZATION_ITERATIONS) {
    costNotes.push("Optimization stopped at the 50-iteration safety limit.");
  }

  costNotes.push("Trustee fees and final checkout total are estimated. Verify at Cardmarket before purchasing.");

  return {
    statusLabel: Number.isFinite(score.total) && savings > 0.005 ? "Best plan" : "Best plan",
    currentTotal,
    selectedTotal: score.total,
    cardTotal: score.cardTotal,
    fixedTotal: score.fixedTotal,
    sellerCosts: score.sellerCosts,
    savings,
    usedSellers,
    droppedSellers,
    selectedOffers,
    warnings,
    costNotes,
    countryWarnings,
    iterations: optimization.iterations,
    insufficientGroups
  };
}

function buildInitialAssignment(groups, sellers, shippingRecords) {
  const cheapestByCard = groups.map((group) => group.candidates[0]).filter(Boolean);
  const currentCartAssignment = groups.map((group) => group.candidates.find((offer) => offer.sellerIndex === group.offers[0]?.sellerIndex) || group.candidates[0]).filter(Boolean);
  const cheapestScore = scoreSelection(cheapestByCard, sellers, shippingRecords);
  const currentScore = scoreSelection(currentCartAssignment, sellers, shippingRecords);
  return isBetterScore(cheapestScore, currentScore) ? cheapestByCard : currentCartAssignment;
}

function optimizeBySellerMoves(initialSelection, groups, sellers, shippingRecords) {
  let selection = [...initialSelection];
  let score = scoreSelection(selection, sellers, shippingRecords);
  let iterations = 0;
  const sellerIndexes = sellers.map((_, sellerIndex) => sellerIndex);

  while (iterations < MAX_OPTIMIZATION_ITERATIONS) {
    let improved = false;
    iterations += 1;

    for (const fromSellerIndex of sellerIndexes) {
      for (const toSellerIndex of sellerIndexes) {
        if (fromSellerIndex === toSellerIndex) {
          continue;
        }

        for (let groupIndex = 0; groupIndex < selection.length; groupIndex += 1) {
          const currentOffer = selection[groupIndex];
          if (!currentOffer || currentOffer.sellerIndex !== fromSellerIndex) {
            continue;
          }

          const nextOffer = groups[groupIndex]?.candidates.find((candidate) => candidate.sellerIndex === toSellerIndex);
          if (!nextOffer) {
            continue;
          }

          const trialSelection = [...selection];
          trialSelection[groupIndex] = nextOffer;
          const trialScore = scoreSelection(trialSelection, sellers, shippingRecords);
          const delta = trialScore.total - score.total;

          if (delta < -0.005) {
            selection = trialSelection;
            score = trialScore;
            improved = true;
          }
        }
      }
    }

    if (!improved) {
      break;
    }
  }

  return { selectedOffers: selection, score, iterations };
}

function scoreSelection(selection, sellers, shippingRecords) {
  const sellerCosts = estimateSelectedSellerCosts(selection, sellers, shippingRecords);
  const cardTotal = selection.reduce((sum, offer) => sum + Number(offer.requiredQuantity || offer.quantity || 1) * Number(offer.unitPrice || 0), 0);
  const fixedTotal = sellerCosts.reduce((sum, cost) => sum + cost.totalCost, 0);

  return {
    total: cardTotal + fixedTotal,
    cardTotal,
    fixedTotal,
    sellerCount: sellerCosts.length,
    sellerCosts
  };
}

function isBetterScore(candidate, current) {
  if (candidate.total < current.total - 0.005) {
    return true;
  }
  if (Math.abs(candidate.total - current.total) < 0.005 && candidate.sellerCount < current.sellerCount) {
    return true;
  }
  return false;
}

function sellerFixedCost(seller) {
  const explicitFixed = Number(seller.shippingValue || 0) + Number(seller.trusteeValue || 0);
  if (explicitFixed > 0) {
    return explicitFixed;
  }

  const total = Number(seller.total);
  const article = Number(seller.articleValue);
  if (Number.isFinite(total) && Number.isFinite(article) && total >= article) {
    return total - article;
  }

  return 0;
}

function estimateSelectedSellerCosts(selection, sellers, shippingRecords) {
  const grouped = groupSelectedOffersBySeller(selection);
  return [...grouped.entries()].map(([sellerIndex, offers]) => estimateSellerCost(sellers[sellerIndex], sellerIndex, offers, shippingRecords));
}

function estimateSellerCost(seller, sellerIndex, offers, shippingRecords) {
  const articleValue = roundMoney(offerSubtotal(offers));
  const quantity = offers.reduce((sum, offer) => sum + Number(offer.requiredQuantity || offer.quantity || 1), 0);
  const shippingResult = calculateShippingCost({
    shippingRecords,
    country: seller.sellerCountry,
    cardCount: quantity,
    orderValue: articleValue
  });

  if (!shippingResult.ok) {
    return {
      sellerIndex,
      source: "unresolved",
      sourceLabel: "No valid dynamic shipping row",
      articleValue,
      quantity,
      estimatedWeight: shippingResult.estimatedWeight,
      shippingMethod: seller.shippingMethod || "Unknown shipping",
      trackingStatus: shippingResult.tracked ? "tracked" : "untracked",
      cardmarketFeeValue: 0,
      shippingValue: Number.POSITIVE_INFINITY,
      totalCost: Number.POSITIVE_INFINITY,
      shippingDebug: shippingResult
    };
  }

  const shippingValue = roundMoney(shippingResult.cost);

  return {
    sellerIndex,
    source: "recalculated",
    sourceLabel: "Dynamic shipping from table",
    articleValue,
    quantity,
    estimatedWeight: shippingResult.estimatedWeight,
    shippingMethod: shippingResult.method,
    trackingStatus: shippingResult.tracked ? "tracked" : "untracked",
    cardmarketFeeValue: shippingResult.cardmarketFeeValue,
    shippingValue,
    totalCost: shippingValue,
    shippingDebug: shippingResult
  };
}

function offerSubtotal(offers) {
  return offers.reduce((sum, offer) => sum + Number(offer.requiredQuantity || offer.quantity || 1) * Number(offer.unitPrice || 0), 0);
}

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function estimateCurrentTotal(sellers) {
  const sellerTotals = sellers.map((seller) => Number(seller.total)).filter(Number.isFinite);
  if (sellerTotals.length) {
    return sellerTotals.reduce((sum, total) => sum + total, 0);
  }

  return sellers.reduce((sum, seller) => {
    const cardTotal = seller.items.reduce((itemSum, item) => itemSum + Number(item.quantity || 1) * Number(item.price || 0), 0);
    return sum + cardTotal + sellerFixedCost(seller);
  }, 0);
}

function optimizationResultTemplate(result) {
  const savingsClass = result.savings > 0.005 ? "good" : "muted";
  const planBySeller = groupSelectedOffersBySeller(result.selectedOffers);
  const costBySeller = new Map(result.sellerCosts.map((cost) => [cost.sellerIndex, cost]));

  return `
    <div class="result-hero">
      <div>
        <span>Best buying plan</span>
        <strong>${escapeHtml(formatEstimatedMoney(result.selectedTotal))}</strong>
      </div>
      <div>
        <span>Reviewed offer pool</span>
        <strong class="muted">${escapeHtml(formatMoney(result.currentTotal))}</strong>
      </div>
      <div>
        <span>Difference</span>
        <strong class="${savingsClass}">${escapeHtml(formatSavings(result.savings))}</strong>
      </div>
      <div>
        <span>Sellers to use</span>
        <strong>${escapeHtml(result.usedSellers.length)}</strong>
      </div>
    </div>

    ${result.warnings.length > 0 ? resultWarningBanner(result.warnings) : ""}
    ${result.costNotes.length > 0 ? resultCostNoteBanner(result.costNotes) : ""}

    ${(result.warnings.length || result.costNotes.length || result.countryWarnings.length) ? `
      <details class="result-details-section">
        <summary>Review details</summary>
        <div class="result-details-body">
          ${result.warnings.map((warning) => `
            <div class="result-detail-card critical">
              <strong>Action required</strong>
              <p>${escapeHtml(warning)}</p>
            </div>
          `).join("")}
          ${result.costNotes.map((note) => `
            <div class="result-detail-card info">
              <strong>Cost note</strong>
              <p>${escapeHtml(note)}</p>
            </div>
          `).join("")}
          ${result.countryWarnings.length ? countryReviewTemplate(result.countryWarnings) : ""}
        </div>
      </details>
    ` : ""}

    <div class="recommendation-grid">
      ${result.usedSellers.map(({ seller, sellerIndex }) => sellerPlanTemplate(seller, sellerIndex, planBySeller.get(sellerIndex) || [], costBySeller.get(sellerIndex))).join("")}
    </div>

    <div class="drop-panel">
      <h3>Sellers to drop</h3>
      ${result.droppedSellers.length
        ? `<p>${result.droppedSellers.map(({ seller }) => escapeHtml(seller.sellerName)).join(", ")}</p>`
        : "<p>No seller can be dropped from this parsed offer set.</p>"}
    </div>
  `;
}

function countryReviewTemplate(countryWarnings) {
  return `
    <div class="country-review-list">
      ${countryWarnings.map(({ seller, sellerIndex }) => countryReviewRowTemplate(seller, sellerIndex)).join("")}
    </div>
  `;
}

function countryReviewRowTemplate(seller, sellerIndex) {
  const reason = seller.countryInference?.ambiguous ? "Ambiguous match" : "No confident match";

  return `
    <div class="country-review-row" data-seller-index="${sellerIndex}">
      <div>
        <strong>${escapeHtml(seller.sellerName)}</strong>
        <span>${escapeHtml(reason)}</span>
      </div>
      <label>
        <span>Country</span>
        ${selectFieldTemplate("", "sellerCountry", seller.sellerCountry || "Unknown", countryOptions())}
      </label>
      <label>
        <span>Shipping method</span>
        <input data-field="shippingMethod" value="${escapeAttribute(seller.shippingMethod || "")}" aria-label="Shipping method for ${escapeAttribute(seller.sellerName)}">
      </label>
      <label>
        <span>Tracked</span>
        ${selectFieldTemplate("", "trackingStatus", seller.trackingStatus || "unknown", ["unknown", "tracked", "untracked"])}
      </label>
    </div>
  `;
}

function sellerPlanTemplate(seller, sellerIndex, offers, sellerCost) {
  const cardTotal = sellerCost?.articleValue ?? offerSubtotal(offers);
  const shippingTotal = sellerCost?.shippingValue ?? 0;
  const feeTotal = sellerCost?.cardmarketFeeValue ?? 0;
  const totalCost = sellerCost?.totalCost ?? (cardTotal + shippingTotal + feeTotal);
  const shippingMethod = sellerCost?.shippingMethod || seller.shippingMethod || "Unknown shipping";
  const trackingLabel = sellerCost?.trackingStatus || seller.trackingStatus || "unknown";
  const shippingSourceClass = sellerCost?.source === "unresolved" ? "warning" : "good";
  const shippingDebug = sellerCost?.shippingDebug;

  return `
    <article class="recommendation-card">
      <header>
        <div>
          <div class="seller-info">
            <span class="eyebrow">Selected seller</span>
            <h3>${escapeHtml(seller.sellerName)}</h3>
          </div>
          <div class="seller-badges">
            <span class="status-pill info">${escapeHtml(seller.sellerCountry || "Unknown")}</span>
            <span class="status-pill muted">${offers.length} card(s)</span>
          </div>
        </div>
        <div class="seller-total">
          <strong>${escapeHtml(formatEstimatedMoney(totalCost))}</strong>
        </div>
      </header>

      <div class="cost-breakdown">
        <div class="breakdown-item">
          <span>Cards</span>
          <strong>${escapeHtml(formatMoney(cardTotal))}</strong>
        </div>
        <div class="breakdown-item">
          <span>Shipping <span class="label-muted">(est.)</span></span>
          <strong>${escapeHtml(formatMoney(shippingTotal))}</strong>
        </div>
        ${SHIPPING_DATA_INCLUDES_CARDMARKET_FEE ? "" : `
          <div class="breakdown-item">
            <span>Fees <span class="label-muted">(est.)</span></span>
            <strong>${escapeHtml(formatMoney(feeTotal))}</strong>
          </div>
        `}
        <div class="breakdown-divider"></div>
        <div class="breakdown-item breakdown-total">
          <span>Total</span>
          <strong>${escapeHtml(formatEstimatedMoney(totalCost))}</strong>
        </div>
      </div>

      <div class="shipping-detail ${shippingSourceClass}">
        <span><strong>${escapeHtml(sellerCost?.sourceLabel || "Original pasted shipping")}</strong></span>
        <span>${escapeHtml(shippingMethod)} · ${escapeHtml(trackingLabel)} · ~${escapeHtml(sellerCost?.estimatedWeight ?? estimateShipmentWeight(offers.length))}g</span>
      </div>

      ${shippingDebug ? `
        <details class="shipping-debug-section">
          <summary>Shipping calculation trace</summary>
          <div class="shipping-debug ${shippingDebug.trackedRequired ? "tracked-required" : ""}">
            Order ${escapeHtml(formatMoney(shippingDebug.orderValue))} / ${escapeHtml(shippingDebug.cardCount)} card(s) / ${escapeHtml(`${shippingDebug.estimatedWeight}g`)}<br>
            Tracking required: <strong>${shippingDebug.trackedRequired ? "yes" : "no"}</strong><br>
            ${escapeHtml(shippingDebug.reason)}<br>
            ${Number.isFinite(shippingDebug.basePrice) ? `Selected base price: ${escapeHtml(formatMoney(shippingDebug.basePrice))}. ` : ""}
            ${shippingDebug.cardmarketFeeIncluded ? "Cardmarket shipping fee is already included in shipping_data.json." : ""}
          </div>
        </details>
      ` : ""}

      <table class="recommendation-table">
        <thead>
          <tr>
            <th>Card</th>
            <th>Qty</th>
            <th>Cond.</th>
            <th>Unit price</th>
          </tr>
        </thead>
        <tbody>
          ${offers.map((offer) => `
            <tr>
              <td>${escapeHtml(offer.cardName)}</td>
              <td>${escapeHtml(offer.requiredQuantity || offer.quantity)}</td>
              <td>${escapeHtml(offer.condition)}</td>
              <td>${escapeHtml(formatMoney(offer.unitPrice))}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </article>
  `;
}

function groupSelectedOffersBySeller(offers) {
  const grouped = new Map();
  offers.forEach((offer) => {
    if (!grouped.has(offer.sellerIndex)) {
      grouped.set(offer.sellerIndex, []);
    }
    grouped.get(offer.sellerIndex).push(offer);
  });
  return grouped;
}

function resultWarningBanner(warnings) {
  return `
    <div class="result-notice critical-notice">
      <div class="notice-header">
        <strong>⚠️ Action required</strong>
        <p>Some desired quantities cannot be fulfilled with available offers.</p>
      </div>
    </div>
  `;
}

function resultCostNoteBanner(costNotes) {
  return `
    <div class="result-notice info-notice">
      <div class="notice-header">
        <strong>ℹ️ Review before buying</strong>
        <p>Some cost assumptions were used. Verify details before checkout.</p>
      </div>
    </div>
  `;
}

function formatSavings(value) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) {
    return "Needs review";
  }
  if (Math.abs(amount) < 0.005) {
    return "EUR 0.00";
  }
  return amount > 0 ? formatMoney(amount) : `+${formatMoney(Math.abs(amount))}`;
}

function formatEstimatedMoney(value) {
  return Number.isFinite(Number(value)) ? formatMoney(value) : "Needs review";
}

function toReviewData() {
  const offerGroups = buildOfferGroups(state.parsed.sellers);
  return {
    rawText: state.parsed.rawText,
    optimizationModel: {
      requiredCards: offerGroups.map((group) => ({
        cardName: group.cardName,
        reviewQuantity: group.requiredQuantity,
        offers: group.offers
      })),
      sellerFixedCosts: state.parsed.sellers.map((seller) => ({
        sellerName: seller.sellerName,
        sellerCountry: seller.sellerCountry,
        shippingMethod: seller.shippingMethod,
        tracked: seller.trackingStatus,
        shippingValue: seller.shippingValue,
        trusteeValue: seller.trusteeValue
      }))
    },
    sellers: state.parsed.sellers.map((seller) => ({
      sellerName: seller.sellerName,
      shippingMethod: seller.shippingMethod,
      trackingStatus: seller.trackingStatus,
      sellerCountry: seller.sellerCountry,
      articleValue: seller.articleValue,
      shippingValue: seller.shippingValue,
      trusteeValue: seller.trusteeValue,
      total: seller.total,
      items: seller.items.map((item) => ({
        cardName: item.cardName,
        condition: item.condition,
        quantity: item.quantity,
        price: item.price,
        rawLine: item.rawLine
      })),
      rawText: seller.rawText
    }))
  };
}

function buildOfferGroups(sellers) {
  const groups = new Map();

  sellers.forEach((seller, sellerIndex) => {
    seller.items.forEach((item, itemIndex) => {
      const key = normalizeOfferKey(item.cardName);
      if (!key) {
        return;
      }

      if (!groups.has(key)) {
        groups.set(key, {
          cardName: item.cardName,
          requiredQuantity: 0,
          sellerCount: 0,
          lowestUnitPrice: Number.POSITIVE_INFINITY,
          offers: []
        });
      }

      const group = groups.get(key);
      const quantity = Number(item.quantity || 1);
      const unitPrice = Number(item.price || 0);
      group.requiredQuantity = Math.max(group.requiredQuantity, quantity);
      group.lowestUnitPrice = Math.min(group.lowestUnitPrice, unitPrice);
      group.offers.push({
        sellerName: seller.sellerName,
        sellerIndex,
        itemIndex,
        cardName: item.cardName,
        condition: item.condition,
        quantity,
        unitPrice,
        sellerCountry: seller.sellerCountry,
        shippingMethod: seller.shippingMethod,
        tracked: seller.trackingStatus
      });
    });
  });

  return [...groups.values()]
    .map((group) => ({
      ...group,
      sellerCount: new Set(group.offers.map((offer) => offer.sellerName)).size,
      lowestUnitPrice: Number.isFinite(group.lowestUnitPrice) ? group.lowestUnitPrice : 0
    }))
    .sort((a, b) => a.cardName.localeCompare(b.cardName));
}

function normalizeOfferKey(cardName) {
  return String(cardName || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function coerceSellerField(field, value) {
  if (["articleValue", "shippingValue", "trusteeValue", "total"].includes(field)) {
    return parseMoney(value) ?? 0;
  }
  return value;
}

function coerceItemField(field, value) {
  if (field === "quantity") {
    return Math.max(1, Number.parseInt(value, 10) || 1);
  }
  if (field === "price") {
    return parseMoney(value) ?? 0;
  }
  return value;
}

function moneyInputValue(value) {
  return value === null || value === undefined || Number.isNaN(Number(value)) ? "" : Number(value).toFixed(2);
}

function countryOptions() {
  return COUNTRY_OPTIONS;
}

function setMessage(message) {
  elements.parseMessage.textContent = message;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}
