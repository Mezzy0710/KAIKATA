import { COUNTRY_OPTIONS, buildShippingIndex, formatMoney, parseCart, parseMoney } from "./parser.mjs?v=20260508h";
import { calculateShippingCost, estimateShipmentWeight, SHIPPING_DATA_INCLUDES_CARDMARKET_FEE } from "./shipping.mjs?v=20260508h";

const manaClasses = ["mana-w", "mana-u", "mana-b", "mana-r", "mana-g"];
const conditionOptions = ["Unknown", "Near Mint", "Mint", "Excellent", "Good", "Light Played", "Played", "Poor"];
const MAX_OPTIMIZATION_ITERATIONS = 50;

const state = {
  shippingData: null,
  parsed: parseCart(""),
  optimizationResult: null,
  showDebug: false
};

const elements = {
  cartInput: document.querySelector("#cartInput"),
  parseButton: document.querySelector("#parseButton"),
  loadSampleButton: document.querySelector("#loadSampleButton"),
  clearButton: document.querySelector("#clearButton"),
  debugToggle: document.querySelector("#debugToggle"),
  runOptimizationButton: document.querySelector("#runOptimizationButton"),
  sellerReview: document.querySelector("#sellerReview"),
  summaryStrip: document.querySelector("#summaryStrip"),
  optimizationSummary: document.querySelector("#optimizationSummary"),
  assignmentOutput: document.querySelector("#assignmentOutput"),
  assumptionsOutput: document.querySelector("#assumptionsOutput"),
  recipientCountry: document.querySelector("#recipientCountry"),
  parseMessage: document.querySelector("#parseMessage"),
  shippingDataState: document.querySelector("#shippingDataState"),
  shippingDataStateText: document.querySelector("#shippingDataStateText"),
  optimizationState: document.querySelector("#optimizationState"),
  optimizationOutput: document.querySelector("#optimizationOutput"),
  emptyStateTemplate: document.querySelector("#emptyStateTemplate")
};

boot();

function boot() {
  elements.parseButton.addEventListener("click", optimizeFromInput);
  if (elements.loadSampleButton) {
    elements.loadSampleButton.addEventListener("click", loadSampleCart);
  }
  elements.clearButton.addEventListener("click", clearInput);
  elements.debugToggle.checked = state.showDebug;
  elements.debugToggle.addEventListener("change", () => {
    state.showDebug = elements.debugToggle.checked;
    render();
  });
  elements.runOptimizationButton.addEventListener("click", runOptimizationPlaceholder);
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
    elements.shippingDataStateText.textContent = "Ready";
    render();
  } catch (error) {
    state.shippingData = null;
    elements.shippingDataState.textContent = window.location.protocol === "file:" ? "Use localhost for shipping data" : "Shipping data missing";
    elements.shippingDataState.className = "status-pill warning";
    elements.shippingDataStateText.textContent = "Unavailable";
    render();
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
  state.optimizationResult = null;
  const warningText = state.parsed.warnings.length ? ` ${state.parsed.warnings.join(" ")}` : "";
  const offerGroups = buildOfferGroups(state.parsed.sellers);
  setMessage(`Parsed ${state.parsed.sellerCount} seller block(s), ${state.parsed.itemCount} seller offer(s), and ${offerGroups.length} card group(s).${warningText}`);
  elements.optimizationState.textContent = "Ready";
  elements.optimizationState.className = "status-pill info";
  render();
}

function clearInput() {
  elements.cartInput.value = "";
  state.parsed = parseCart("");
  state.optimizationResult = null;
  elements.optimizationState.textContent = "Waiting";
  elements.optimizationState.className = "status-pill muted";
  setMessage("No cart parsed yet.");
  render();
}

function optimizeFromInput() {
  parseCurrentInput();
  runOptimizationPlaceholder();
}

function render() {
  const sellers = state.parsed.sellers || [];
  const itemCount = sellers.reduce((sum, seller) => sum + seller.items.length, 0);
  const offerGroups = buildOfferGroups(sellers);
  const parsedTotal = sellers.reduce((sum, seller) => sum + Number(seller.total || 0), 0);

  elements.recipientCountry.textContent = "Germany";

  renderSummary(sellers, itemCount, offerGroups, parsedTotal);
  renderSellers(sellers, offerGroups);
  renderOptimizationViews();
}

function renderSummary(sellers, itemCount, offerGroups, parsedTotal) {
  const ambiguousCount = sellers.filter((seller) => seller.countryInference?.ambiguous).length;
  const unknownCountryCount = sellers.filter((seller) => !seller.sellerCountry || seller.sellerCountry === "Unknown").length;
  const pricedOfferCount = sellers.reduce((sum, seller) => sum + seller.items.filter((item) => Number.isFinite(Number(item.price))).length, 0);
  const competitiveCards = offerGroups.filter((group) => group.sellerCount > 1).length;
  const warningCount = ambiguousCount + unknownCountryCount + state.parsed.warnings.length;

  elements.summaryStrip.innerHTML = [
    summaryCard("Sellers found", sellers.length, sellers.length ? "good" : "muted"),
    summaryCard("Cards parsed", itemCount, itemCount ? "good" : "muted"),
    summaryCard("Prices found", pricedOfferCount, pricedOfferCount ? "good" : "muted"),
    summaryCard("Recipient", "Germany", "info"),
    summaryCard("Shipping data", state.shippingData ? "Ready" : "Missing", state.shippingData ? "good" : "warning"),
    summaryCard("Warnings", warningCount || "Clear", warningCount ? "warning" : "good"),
    summaryCard("Competitive cards", competitiveCards, competitiveCards ? "info" : "muted"),
    summaryCard("Parsed total", formatMoney(parsedTotal), parsedTotal ? "info" : "muted")
  ].join("");
}

function summaryCard(label, value, tone = "muted") {
  return `
    <div class="summary-card summary-card-${escapeAttribute(tone)}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `;
}

function renderOptimizationViews() {
  if (!state.optimizationResult) {
    elements.optimizationSummary.innerHTML = summaryEmptyState();
    elements.optimizationOutput.innerHTML = recommendationsEmptyState();
    elements.assignmentOutput.innerHTML = assignmentEmptyState();
    elements.assumptionsOutput.innerHTML = assumptionsEmptyState();
    return;
  }

  elements.optimizationSummary.innerHTML = optimizationSummaryTemplate(state.optimizationResult);
  elements.optimizationOutput.innerHTML = recommendationsTemplate(state.optimizationResult);
  elements.assignmentOutput.innerHTML = assignmentTableTemplate(state.optimizationResult);
  elements.assumptionsOutput.innerHTML = assumptionsTemplate(state.optimizationResult);
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

function runOptimizationPlaceholder() {
  const sellers = state.parsed.sellers || [];
  const offerGroups = buildOfferGroups(sellers);

  if (!sellers.length || !offerGroups.length) {
    state.optimizationResult = null;
    elements.optimizationState.textContent = "No data";
    elements.optimizationState.className = "status-pill warning";
    renderOptimizationViews();
    return;
  }

  state.optimizationResult = optimizeCart(sellers, offerGroups);
  elements.optimizationState.textContent = state.optimizationResult.statusLabel;
  elements.optimizationState.className = state.optimizationResult.warnings.length ? "status-pill warning" : "status-pill good";
  renderOptimizationViews();
  elements.optimizationSummary.scrollIntoView({ behavior: "smooth", block: "start" });
}

function updateOptimizationPreview() {
  state.optimizationResult = null;
  elements.optimizationState.textContent = "Changed";
  elements.optimizationState.className = "status-pill warning";
  const sellers = state.parsed.sellers;
  renderSummary(sellers, state.parsed.itemCount, buildOfferGroups(sellers), sellers.reduce((sum, seller) => sum + Number(seller.total || 0), 0));
  renderOptimizationViews();
}

function optimizeCart(sellers, offerGroups) {
  const shippingRecords = buildShippingIndex(state.shippingData);
  const groups = offerGroups.map((group) => {
    const validOffers = group.offers.filter((offer) => offer.quantity >= group.requiredQuantity);
    return {
      ...group,
      candidates: (validOffers.length ? validOffers : group.offers)
        .map((offer) => ({ ...offer, requiredQuantity: group.requiredQuantity }))
        .sort((a, b) => a.unitPrice - b.unitPrice)
    };
  });
  const warnings = [];
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

  if (!shippingRecords.length) {
    warnings.push("Shipping table unavailable: optimization cannot price dynamic shipping.");
  }

  if (incompleteGroups.length) {
    warnings.push(`${incompleteGroups.length} card group(s) had no single seller offer with the full reviewed quantity.`);
  }

  if (countryWarnings.length) {
    warnings.push(`${countryWarnings.length} selected seller(s) still need country/shipping review.`);
  }

  if (unresolvedShippingCosts.length) {
    warnings.push(`${unresolvedShippingCosts.length} selected seller(s) have no valid dynamic shipping row. Review country and shipping data.`);
  }

  if (optimization.iterations >= MAX_OPTIMIZATION_ITERATIONS) {
    warnings.push("Optimization stopped at the 50-iteration safety limit.");
  }

  return {
    statusLabel: Number.isFinite(score.total) && savings > 0.005 ? "Savings found" : "Best plan",
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
    countryWarnings,
    iterations: optimization.iterations
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

function optimizationSummaryTemplate(result) {
  const cardValue = result.cardTotal;
  const shippingTotal = result.sellerCosts.reduce((sum, sellerCost) => sum + (Number.isFinite(sellerCost.shippingValue) ? sellerCost.shippingValue : 0), 0);
  const feeTotal = result.sellerCosts.reduce((sum, sellerCost) => sum + Number(sellerCost.cardmarketFeeValue || 0), 0);
  const savingsPercent = result.currentTotal > 0 && Number.isFinite(result.selectedTotal)
    ? `${((result.savings / result.currentTotal) * 100).toFixed(1)}%`
    : "0.0%";
  const warningBanner = result.warnings.length
    ? `
      <div class="result-warning">
        ${result.warnings.map((warning) => `<p>${escapeHtml(warning)}</p>`).join("")}
        ${result.countryWarnings.length ? countryReviewTemplate(result.countryWarnings) : ""}
      </div>
    `
    : "";

  return `
    <div class="summary-hero-card">
      <div class="summary-hero-copy">
        <span class="eyebrow">Optimization result</span>
        <h3>${escapeHtml(formatEstimatedMoney(result.selectedTotal))}</h3>
        <p>${escapeHtml(Number.isFinite(result.savings) && result.savings > 0 ? "Lowest total found from the current reviewed seller pool." : "Current reviewed allocation is already the best plan found.")}</p>
      </div>
      <div class="summary-savings">
        <span>Savings</span>
        <strong class="${result.savings > 0.005 ? "good" : "muted"}">${escapeHtml(formatSavings(result.savings))}</strong>
        <small>${escapeHtml(savingsPercent)} vs. original</small>
      </div>
    </div>
    ${warningBanner}
    <div class="result-hero premium-metrics">
      <div><span>Original total</span><strong>${escapeHtml(formatMoney(result.currentTotal))}</strong></div>
      <div><span>Optimized total</span><strong>${escapeHtml(formatEstimatedMoney(result.selectedTotal))}</strong></div>
      <div><span>Sellers used</span><strong>${escapeHtml(result.usedSellers.length)}</strong></div>
      <div><span>Article value</span><strong>${escapeHtml(formatMoney(cardValue))}</strong></div>
      <div><span>Shipping total</span><strong>${escapeHtml(formatEstimatedMoney(shippingTotal))}</strong></div>
      <div><span>Trustee / fees</span><strong>${escapeHtml(SHIPPING_DATA_INCLUDES_CARDMARKET_FEE ? "Included" : formatEstimatedMoney(feeTotal))}</strong></div>
    </div>
  `;
}

function recommendationsTemplate(result) {
  const planBySeller = groupSelectedOffersBySeller(result.selectedOffers);
  const costBySeller = new Map(result.sellerCosts.map((cost) => [cost.sellerIndex, cost]));

  return `
    <div class="recommendation-grid">
      ${result.usedSellers.map(({ seller, sellerIndex }) => sellerPlanTemplate(seller, sellerIndex, planBySeller.get(sellerIndex) || [], costBySeller.get(sellerIndex))).join("")}
    </div>
    <div class="drop-panel">
      <h3>Sellers not used</h3>
      ${result.droppedSellers.length
        ? `<p>${result.droppedSellers.map(({ seller }) => escapeHtml(seller.sellerName)).join(", ")}</p>`
        : "<p>Every parsed seller contributes to the current best result.</p>"}
    </div>
  `;
}

function assignmentTableTemplate(result) {
  if (!result.selectedOffers.length) {
    return assignmentEmptyState();
  }

  return `
    <div class="assignment-table-wrap">
      <table class="assignment-table">
        <thead>
          <tr>
            <th>Card</th>
            <th>Qty</th>
            <th>Condition</th>
            <th>Selected seller</th>
            <th>Price</th>
            <th>Notes / reason</th>
          </tr>
        </thead>
        <tbody>
          ${result.selectedOffers.map((offer) => assignmentRowTemplate(offer, result)).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function assignmentRowTemplate(offer, result) {
  const alternativeCount = result.selectedOffers.filter((candidate) => normalizeOfferKey(candidate.cardName) === normalizeOfferKey(offer.cardName)).length;
  const note = alternativeCount > 1
    ? "Selected for lowest combined seller cost."
    : "Selected seller is the active recommendation.";

  return `
    <tr>
      <td>${escapeHtml(offer.cardName)}</td>
      <td>${escapeHtml(offer.requiredQuantity || offer.quantity)}</td>
      <td>${escapeHtml(offer.condition || "Unknown")}</td>
      <td>${escapeHtml(offer.sellerName)}</td>
      <td>${escapeHtml(formatMoney(offer.unitPrice))}</td>
      <td>${escapeHtml(note)}</td>
    </tr>
  `;
}

function assumptionsTemplate(result) {
  return `
    <details class="calculation-details" ${result.warnings.length ? "open" : ""}>
      <summary>Calculation details &amp; assumptions</summary>
      <div class="assumptions-list">
        ${result.sellerCosts.map((sellerCost) => assumptionsCardTemplate(result, sellerCost)).join("")}
      </div>
    </details>
  `;
}

function assumptionsCardTemplate(result, sellerCost) {
  const seller = result.usedSellers.find((entry) => entry.sellerIndex === sellerCost.sellerIndex)?.seller;
  const shippingDebug = sellerCost.shippingDebug;

  return `
    <article class="assumption-card">
      <div class="assumption-card-header">
        <strong>${escapeHtml(seller?.sellerName || `Seller ${sellerCost.sellerIndex + 1}`)}</strong>
        <span class="status-pill ${sellerCost.source === "unresolved" ? "warning" : "good"}">${escapeHtml(sellerCost.source === "unresolved" ? "Estimated / review" : "Exact from table")}</span>
      </div>
      <p>${escapeHtml(shippingDebug?.reason || "Shipping method selected from the available country rows.")}</p>
      <ul class="assumption-points">
        <li>Weight estimate: ${escapeHtml(`${sellerCost.estimatedWeight}g`)}</li>
        <li>Tracking: ${escapeHtml(sellerCost.trackingStatus)}</li>
        <li>Method: ${escapeHtml(sellerCost.shippingMethod || "Unknown")}</li>
        <li>Cardmarket fee handling: ${escapeHtml(SHIPPING_DATA_INCLUDES_CARDMARKET_FEE ? "Included in shipping data" : "Added separately")}</li>
      </ul>
    </article>
  `;
}

function summaryEmptyState() {
  return `<p class="result-empty">Run optimization to compare the current cart against the recommended seller mix.</p>`;
}

function recommendationsEmptyState() {
  return `<p class="result-empty">Recommended seller cards will appear here after optimization.</p>`;
}

function assignmentEmptyState() {
  return `<p class="result-empty">Selected seller assignments will appear here after optimization.</p>`;
}

function assumptionsEmptyState() {
  return `<p class="result-empty">Shipping thresholds, selected methods, and calculation assumptions will appear here after optimization.</p>`;
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
  const fixedCost = sellerCost?.totalCost ?? sellerFixedCost(seller);
  const shippingMethod = sellerCost?.shippingMethod || seller.shippingMethod || "Unknown shipping";
  const trackingLabel = sellerCost?.trackingStatus || seller.trackingStatus || "unknown";
  const shippingSourceClass = sellerCost?.source === "unresolved" ? "warning" : "good";
  const itemCount = offers.reduce((sum, offer) => sum + Number(offer.requiredQuantity || offer.quantity || 1), 0);

  return `
    <article class="recommendation-card premium-seller-card">
      <header>
        <div class="recommendation-header-copy">
          <span class="eyebrow">Buy from this seller</span>
          <h3>${escapeHtml(seller.sellerName)}</h3>
          <div class="seller-card-badges">
            <span class="status-pill info">${escapeHtml(seller.sellerCountry || "Unknown")}</span>
            <span class="status-pill ${trackingLabel === "tracked" ? "good" : "muted"}">${escapeHtml(trackingLabel)}</span>
            <span class="status-pill muted">${escapeHtml(`${itemCount} card${itemCount === 1 ? "" : "s"}`)}</span>
          </div>
        </div>
        <strong class="seller-total">${escapeHtml(formatEstimatedMoney(cardTotal + fixedCost))}</strong>
      </header>
      <dl class="seller-metric-grid">
        <div><dt>Cards</dt><dd>${escapeHtml(formatMoney(cardTotal))}</dd></div>
        <div><dt>Shipping</dt><dd>${escapeHtml(formatEstimatedMoney(sellerCost?.shippingValue ?? fixedCost))}</dd></div>
        <div><dt>CM fee</dt><dd>${escapeHtml(SHIPPING_DATA_INCLUDES_CARDMARKET_FEE ? "Included" : formatEstimatedMoney(sellerCost?.cardmarketFeeValue ?? 0))}</dd></div>
        <div><dt>Method</dt><dd>${escapeHtml(shippingMethod)}</dd></div>
      </dl>
      <p class="shipping-detail ${shippingSourceClass}">
        <strong>${escapeHtml(sellerCost?.sourceLabel || "Original pasted shipping")}</strong>
        ${escapeHtml(shippingMethod)} - ${escapeHtml(trackingLabel)} - ${escapeHtml(`${sellerCost?.estimatedWeight ?? estimateShipmentWeight(offers.length)}g est.`)}
      </p>
      <table class="recommendation-table">
        <thead>
          <tr>
            <th>Card</th>
            <th>Qty</th>
            <th>Cond.</th>
            <th>Unit</th>
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
