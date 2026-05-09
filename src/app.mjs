import { COUNTRY_OPTIONS, buildShippingIndex, formatMoney, parseCart, parseMoney } from "./parser.mjs?v=20260509f";
import {
  calculateShippingCost,
  calculateTrusteeFee,
  estimateShipmentWeight,
  SHIPPING_DATA_INCLUDES_CARDMARKET_FEE
} from "./shipping.mjs?v=20260509f";
import {
  getReferencePrice,
  enrichCardsWithReferencePrices,
  initScryallCache
} from "./scryfall.mjs?v=20260509g";
import {
  calculatePriceDelta,
  getDeltaColor,
  formatDeltaDisplay,
  enrichCardWithReference,
  hasHighPricedCards,
  generateHighPriceNote
} from "./price-verdict.mjs?v=20260509g";

const manaClasses = ["mana-w", "mana-u", "mana-b", "mana-r", "mana-g"];
const conditionOptions = ["Unknown", "Near Mint", "Mint", "Excellent", "Good", "Light Played", "Played", "Poor"];
const MAX_OPTIMIZATION_ITERATIONS = 50;

const ICON_CHART = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"></path><path d="M18 17V9"></path><path d="M13 17V5"></path><path d="M8 17v-4"></path></svg>`;
const ICON_CART = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"></circle><circle cx="20" cy="21" r="1"></circle><path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6"></path></svg>`;
const ICON_LIST = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"></rect><path d="M7 8h10M7 12h10M7 16h6"></path></svg>`;
const ICON_INFO = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M12 16v-4"></path><path d="M12 8h.01"></path></svg>`;

const state = {
  shippingData: null,
  shippingDataState: "loading", // "loading" | "loaded" | "error"
  parsed: parseCart(""),
  optimizationResult: null,
  showDebug: false,
  inputCollapsed: false,
  desiredQuantityByCard: {},
  optimizationStale: false,
  // Reference price check feature
  priceReferences: {}, // Map<normalizedCardName, referencePriceData>
  scryallLookupInProgress: false, // Show loading state while fetching
  referenceCheckEnabled: true // Can be disabled in settings (v2)
};

const hasDom = typeof document !== "undefined";

const elements = hasDom ? {
  cartInput: document.querySelector("#cartInput"),
  parseButton: document.querySelector("#parseButton"),
  loadSampleButton: document.querySelector("#loadSampleButton"),
  clearButton: document.querySelector("#clearButton"),
  editCartButton: document.querySelector("#editCartButton"),
  debugToggle: document.querySelector("#debugToggle"),
  runOptimizationButton: document.querySelector("#runOptimizationButton"),
  desiredCardsReview: document.querySelector("#desiredCardsReview"),
  sellerReview: document.querySelector("#sellerReview"),
  summaryStrip: document.querySelector("#summaryStrip"),
  optimizationSummary: document.querySelector("#optimizationSummary"),
  assignmentOutput: document.querySelector("#assignmentOutput"),
  assumptionsOutput: document.querySelector("#assumptionsOutput"),
  recipientCountry: document.querySelector("#recipientCountry"),
  parseMessage: document.querySelector("#parseMessage"),
  inputEditor: document.querySelector("#inputEditor"),
  inputSummary: document.querySelector("#inputSummary"),
  shippingDataStatus: document.querySelector("#shippingDataStatus"),
  optimizationState: document.querySelector("#optimizationState"),
  optimizationOutput: document.querySelector("#optimizationOutput"),
  emptyStateTemplate: document.querySelector("#emptyStateTemplate")
} : {};

if (hasDom) {
  boot();
}

function boot() {
  // Initialize Scryfall cache for reference price lookups
  if (state.referenceCheckEnabled) {
    initScryallCache().catch(error => {
      console.error('Failed to initialize Scryfall cache:', error);
    });
  }

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
  elements.desiredCardsReview.addEventListener("change", handleDesiredQuantityChange);
  elements.desiredCardsReview.addEventListener("click", handleDesiredQuantityClick);
  elements.sellerReview.addEventListener("change", handleReviewChange);
  elements.sellerReview.addEventListener("click", handleReviewClick);
  elements.optimizationOutput.addEventListener("change", handleReviewChange);

  loadShippingData();
  render();
}

async function loadShippingData() {
  state.shippingDataState = "loading";
  updateOptimizeButton();
  try {
    const response = await fetch("./shipping_data.json", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    state.shippingData = await response.json();
    state.shippingDataState = "loaded";
    updateOptimizeButton();
    render();
  } catch (error) {
    state.shippingData = null;
    state.shippingDataState = "error";
    updateOptimizeButton();
    render();
  }
}

function updateOptimizeButton() {
  const { shippingDataState } = state;
  const isLoading = shippingDataState === "loading";

  elements.parseButton.disabled = isLoading;
  elements.parseButton.textContent = isLoading ? "Loading…" : "Optimize Cart";

  const statusEl = elements.shippingDataStatus;
  if (!statusEl) return;

  if (shippingDataState === "loading") {
    statusEl.textContent = "Loading shipping data…";
    statusEl.className = "shipping-load-status loading";
  } else if (shippingDataState === "loaded") {
    statusEl.textContent = "";
    statusEl.className = "shipping-load-status";
  } else if (shippingDataState === "error") {
    statusEl.textContent = window.location.protocol === "file:"
      ? "⚠ Shipping data unavailable via file://. Open via a local server or GitHub Pages."
      : "⚠ Could not load shipping data. Optimization will run but cannot compute shipping costs.";
    statusEl.className = "shipping-load-status error";
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
  state.optimizationStale = true;
  const warningText = state.parsed.warnings.length ? ` ${state.parsed.warnings.join(" ")}` : "";
  const offerGroups = buildOfferGroups(state.parsed.sellers);

  state.desiredQuantityByCard = {};
  offerGroups.forEach((group) => {
    state.desiredQuantityByCard[group.cardName] = group.requiredQuantity;
  });

  const totalCopies = getTotalCopies(offerGroups);
  setMessage(`Parsed ${state.parsed.sellerCount} seller block(s), ${state.parsed.itemCount} seller offer(s), ${offerGroups.length} different card(s), and ${totalCopies} total copies.${warningText}`);
  elements.optimizationState.textContent = "Ready";
  elements.optimizationState.className = "status-pill info";
  render();

  // Trigger async Scryfall enrichment (non-blocking)
  if (state.referenceCheckEnabled && state.parsed.sellers.length > 0) {
    enrichParserResultsWithScryfall(state.parsed.sellers).catch(error => {
      console.error('Scryfall enrichment failed:', error);
    });
  }
}

/**
 * Asynchronously enrich parsed cards with Scryfall reference prices
 *
 * @param {array} sellers - Array of seller objects from parsed cart
 */
async function enrichParserResultsWithScryfall(sellers) {
  state.scryallLookupInProgress = true;
  render(); // Show loading state

  try {
    // Extract unique card names from all sellers
    const cardNames = new Set();
    sellers.forEach(seller => {
      seller.items.forEach(item => {
        if (item.cardName) {
          cardNames.add(item.cardName);
        }
      });
    });

    if (cardNames.size === 0) {
      return; // No cards to look up
    }

    // Bulk lookup with Scryfall
    const references = await enrichCardsWithReferencePrices([...cardNames]);

    // Store in state, keyed by normalized name
    references.forEach((refData, normalizedKey) => {
      state.priceReferences[normalizedKey] = refData;
    });

  } catch (error) {
    console.error('Scryfall lookup failed:', error);
    // Don't break the app - just skip reference prices
  } finally {
    state.scryallLookupInProgress = false;
    render(); // Update UI with reference prices
  }
}

function clearInput() {
  elements.cartInput.value = "";
  state.parsed = parseCart("");
  state.optimizationResult = null;
  state.inputCollapsed = false;
  state.desiredQuantityByCard = {};
  state.optimizationStale = false;
  state.priceReferences = {}; // Clear reference prices
  state.scryallLookupInProgress = false;
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

  if (elements.recipientCountry) {
    elements.recipientCountry.textContent = "Germany";
  }

  renderStepper(sellers);
  updateRunOptimizationButtonVisibility();
  renderInputState(sellers, parsedTotal);
  renderSummary(sellers, itemCount, offerGroups, parsedTotal);
  renderDesiredCards(offerGroups);
  renderSellers(sellers, offerGroups);
  renderOptimizationViews();
}

function renderStepper(sellers) {
  const stepper = document.querySelector("#appStepper");
  if (!stepper) return;

  const hasParsedData = sellers.length > 0;
  const hasResult = !!state.optimizationResult;

  let activeStep = 1;
  if (hasResult) {
    activeStep = 3;
  } else if (hasParsedData) {
    activeStep = 2;
  }

  stepper.querySelectorAll(".stepper-item").forEach((item) => {
    const step = Number(item.dataset.step);
    item.classList.remove("active", "done");
    if (step < activeStep) {
      item.classList.add("done");
    } else if (step === activeStep) {
      item.classList.add("active");
    }
  });

  stepper.querySelectorAll(".stepper-line").forEach((line) => {
    const fromStep = Number(line.dataset.from);
    line.classList.toggle("done", fromStep < activeStep);
  });
}

function updateRunOptimizationButtonVisibility() {
  // Only show "Re-run Optimization" button when there's already a result to re-run.
  // Before the first optimization, this button is confusing and should stay hidden.
  const hasResult = !!state.optimizationResult;
  elements.runOptimizationButton.style.display = hasResult ? "" : "none";
}

function renderInputState(sellers, parsedTotal) {
  const canCollapse = state.inputCollapsed && state.optimizationResult && sellers.length;
  elements.inputEditor.classList.toggle("hidden", Boolean(canCollapse));
  elements.inputSummary.classList.toggle("hidden", !canCollapse);

  if (!canCollapse) {
    elements.inputSummary.innerHTML = "";
    return;
  }

  elements.inputSummary.innerHTML = `
    <div class="input-summary-card">
      <div class="input-summary-copy">
        <span class="status-pill good">Cart parsed successfully</span>
        <h3>Ready to review your buying plan</h3>
        <p>${escapeHtml(`${sellers.length} seller${sellers.length === 1 ? "" : "s"} found, ${state.parsed.itemCount} offer${state.parsed.itemCount === 1 ? "" : "s"} parsed, original total ${formatMoney(parsedTotal)}.`)}</p>
      </div>
      <div class="button-row input-summary-actions">
        <button id="editCartButton" class="ghost-button" type="button">Edit pasted cart</button>
        <button id="clearButtonCompact" class="ghost-button" type="button">Clear</button>
      </div>
    </div>
  `;

  elements.editCartButton = document.querySelector("#editCartButton");
  if (elements.editCartButton) {
    elements.editCartButton.addEventListener("click", () => {
      state.inputCollapsed = false;
      render();
    });
  }

  const compactClear = document.querySelector("#clearButtonCompact");
  if (compactClear) {
    compactClear.addEventListener("click", clearInput);
  }
}

function renderSummary(sellers, itemCount, offerGroups, parsedTotal) {
  const ambiguousCount = sellers.filter((seller) => seller.countryInference?.ambiguous).length;
  const unknownCountryCount = sellers.filter((seller) => !seller.sellerCountry || seller.sellerCountry === "Unknown").length;
  const pricedOfferCount = sellers.reduce((sum, seller) => sum + seller.items.filter((item) => Number.isFinite(Number(item.price))).length, 0);
  const warningCount = ambiguousCount + unknownCountryCount + state.parsed.warnings.length;

  if (elements.summaryStrip) {
    elements.summaryStrip.innerHTML = [
      summaryCard(sellers.length ? "Parsed successfully" : "Waiting for cart", sellers.length ? "Ready" : "Idle", sellers.length ? "good" : "muted"),
      summaryCard("Sellers", sellers.length, sellers.length ? "good" : "muted"),
      summaryCard("Offers", itemCount, itemCount ? "good" : "muted"),
      summaryCard("Prices found", pricedOfferCount, pricedOfferCount ? "good" : "muted"),
      summaryCard("Shipping data", state.shippingData ? "Ready" : "Missing", state.shippingData ? "good" : "warning"),
      summaryCard("Warnings", warningCount ? `${warningCount} to review` : "Clear", warningCount ? "warning" : "good")
    ].join("");
  }
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

  const copyBtn = document.querySelector("#copyPlanButton");
  if (copyBtn) {
    copyBtn.addEventListener("click", () => copyBuyingPlan(state.optimizationResult));
  }
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
        <span class="summary-meta">${selectedTotal} different card(s) · ${detectedTotal} total copies selected</span>
      </summary>
      <div class="review-details-body">
        <p class="note-text">Quantities are inferred from the pasted cart. Adjust them before optimizing if needed.</p>
        ${referenceStatusTemplate()}
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
              <th>Scryfall ref</th>
              <th>Vs Scryfall</th>
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
  const referenceData = getReferenceData(group.cardName);
  const referenceCard = enrichCardWithReference({ cardName: group.cardName, price: group.lowestUnitPrice }, referenceData);
  const referenceDisplay = referencePriceDisplay(referenceData);
  const deltaDisplay = referenceDeltaDisplay(referenceCard, referenceData);

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
      <td class="reference-cell">${referenceDisplay}</td>
      <td class="reference-cell">${deltaDisplay}</td>
      <td><span class="status-pill ${statusClass}">${escapeHtml(statusLabel)}</span></td>
    </tr>
  `;
}

function referenceStatusTemplate() {
  if (!state.referenceCheckEnabled) {
    return "";
  }

  if (state.scryallLookupInProgress) {
    return `<p class="note-text reference-status-text">Scryfall reference prices are loading for detected cards.</p>`;
  }

  const referenceCount = Object.values(state.priceReferences).filter((entry) => entry && !entry.error).length;
  if (referenceCount > 0) {
    return `<p class="note-text reference-status-text">Scryfall reference prices are shown where available.</p>`;
  }

  return `<p class="note-text reference-status-text">Scryfall reference prices are unavailable for this review right now.</p>`;
}

function referencePriceDisplay(referenceData) {
  if (state.scryallLookupInProgress && !referenceData) {
    return `<span class="reference-muted">Loading...</span>`;
  }

  if (!referenceData) {
    return `<span class="reference-muted">Pending</span>`;
  }

  if (referenceData.error) {
    return `<span class="reference-muted" title="${escapeAttribute(referenceErrorLabel(referenceData.reason))}">Unavailable</span>`;
  }

  return `<span class="price-with-reference">${escapeHtml(formatReferenceMoney(referenceData.price, referenceData.currency))}${referenceSourceIcon(referenceData)}</span>`;
}

function referenceDeltaDisplay(referenceCard, referenceData) {
  if (state.scryallLookupInProgress && !referenceData) {
    return `<span class="reference-muted">Loading...</span>`;
  }

  if (!referenceData || referenceData.error || !referenceCard.hasReference) {
    return `<span class="reference-muted">-</span>`;
  }

  return `<span class="reference-delta-badge delta-${escapeAttribute(referenceCard.deltaColor)}" title="${escapeAttribute(referenceDeltaTitle(referenceCard, referenceData))}">${escapeHtml(referenceCard.deltaDisplay)}</span>`;
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
    state.optimizationResult = null;
    elements.optimizationState.textContent = "No data";
    elements.optimizationState.className = "status-pill warning";
    renderOptimizationViews();
    return;
  }

  state.optimizationStale = false;
  state.optimizationResult = optimizeCart(sellers, offerGroups);
  state.inputCollapsed = true;
  elements.optimizationState.textContent = state.optimizationResult.statusLabel;
  elements.optimizationState.className = state.optimizationResult.warnings.length ? "status-pill warning" : "status-pill good";
  render();
  elements.optimizationSummary.scrollIntoView({ behavior: "smooth", block: "start" });
}

function updateOptimizationPreview() {
  state.optimizationResult = null;
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
  const offerGroups = buildOfferGroups(sellers);
  renderSummary(sellers, state.parsed.itemCount, offerGroups, sellers.reduce((sum, seller) => sum + Number(seller.total || 0), 0));

  document.getElementById("rerunOptimizationButton")?.addEventListener("click", runOptimizationPlaceholder);
  elements.assignmentOutput.innerHTML = assignmentEmptyState();
  elements.assumptionsOutput.innerHTML = assumptionsEmptyState();
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
    costNotes.push(`${incompleteGroups.length} card(s) had no single seller offer with the full quantity.`);
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
  const statusLabel = insufficientGroups.length
    ? "Action required"
    : unresolvedShippingCosts.length || countryWarnings.length
      ? "Needs review"
      : "Best plan ready";

  return {
    statusLabel,
    currentTotal,
    selectedTotal: score.total,
    cardTotal: score.cardTotal,
    fixedTotal: score.fixedTotal,
    trusteeTotal: score.trusteeTotal,
    shippingTotal: score.shippingTotal,
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
  const consolidatedAssignments = sellers
    .map((_, sellerIndex) => groups.map((group) => group.candidates.find((offer) => offer.sellerIndex === sellerIndex)))
    .filter((assignment) => assignment.length && assignment.every(Boolean));
  const candidates = [cheapestByCard, currentCartAssignment, ...consolidatedAssignments].filter((assignment) => assignment.length);

  return candidates.reduce((bestAssignment, assignment) => {
    const candidateScore = scoreSelection(assignment, sellers, shippingRecords);
    const bestScore = scoreSelection(bestAssignment, sellers, shippingRecords);
    return isBetterScore(candidateScore, bestScore) ? assignment : bestAssignment;
  }, candidates[0] || []);
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
  const shippingTotal = sellerCosts.reduce((sum, cost) => sum + (Number.isFinite(cost.shippingValue) ? cost.shippingValue : 0), 0);
  const trusteeTotal = sellerCosts.reduce((sum, cost) => sum + (Number.isFinite(cost.trusteeFeeValue) ? cost.trusteeFeeValue : 0), 0);

  return {
    total: cardTotal + fixedTotal,
    cardTotal,
    fixedTotal,
    shippingTotal,
    trusteeTotal,
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
  const trusteeMethod = shippingResult.ok ? shippingResult.method : seller.shippingMethod;
  const trusteeTracked = shippingResult.ok ? shippingResult.tracked : seller.trackingStatus === "tracked";
  const trusteeResult = calculateTrusteeFee({
    articleValue,
    shippingMethod: trusteeMethod,
    tracked: trusteeTracked,
    sellerLifetimeSales: seller.sellerLifetimeSales ?? seller.completedSales ?? null
  });
  const exactParsedTrustee = exactParsedTrusteeValue(seller, articleValue, quantity, trusteeMethod, trusteeTracked);
  const trusteeFeeValue = roundMoney(exactParsedTrustee ?? trusteeResult.fee);
  const trusteeSource = exactParsedTrustee !== null ? "parsed_exact" : "estimated_rule";
  const trusteeSourceLabel = exactParsedTrustee !== null ? "Exact from parsed cart" : "Estimated from trustee rule";

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
      trusteeFeeValue,
      trusteeRate: trusteeResult.rate,
      trusteeMethodCategory: trusteeResult.methodCategory,
      trusteeSource,
      trusteeSourceLabel,
      shippingValue: Number.POSITIVE_INFINITY,
      totalCost: Number.POSITIVE_INFINITY,
      shippingDebug: shippingResult,
      trusteeDebug: trusteeResult
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
    trusteeFeeValue,
    trusteeRate: trusteeResult.rate,
    trusteeMethodCategory: trusteeResult.methodCategory,
    trusteeSource,
    trusteeSourceLabel,
    shippingValue,
    totalCost: roundMoney(shippingValue + trusteeFeeValue),
    shippingDebug: shippingResult,
    trusteeDebug: trusteeResult
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
  const shippingTotal = result.shippingTotal;
  const trusteeTotal = result.trusteeTotal;
  const feeTotal = result.sellerCosts.reduce((sum, sellerCost) => sum + Number(sellerCost.cardmarketFeeValue || 0), 0);
  const warningEntries = buildResultWarnings(result);
  const warningBanner = warningEntries.length ? warningBannerTemplate(result, warningEntries) : "";
  const selectedCardGroups = result.selectedOffers.length;
  const totalCopies = result.selectedOffers.reduce((sum, offer) => sum + Number(offer.requiredQuantity || offer.quantity || 1), 0);
  const hasEstimatedTrustee = result.sellerCosts.some((sellerCost) => sellerCost.trusteeSource !== "parsed_exact");
  const trusteeLabel = hasEstimatedTrustee ? "Fees / trustee (estimated)" : "Fees / trustee";
  const trusteeNote = "Verify at Cardmarket checkout";

  return `
    <div class="summary-hero-card">
      <div class="summary-hero-copy">
        <span class="eyebrow">Best buying plan</span>
        <h3>${escapeHtml(formatEstimatedMoney(result.selectedTotal))}</h3>
        <p>Buy the cards from the sellers below.</p>
      </div>
    </div>
    ${warningBanner}
    <div class="result-hero guided-metrics">
      <div class="guided-metric"><span>Optimized buying plan</span><strong>${escapeHtml(formatEstimatedMoney(result.selectedTotal))}</strong></div>
      <div class="guided-metric"><span>Sellers to use</span><strong>${escapeHtml(result.usedSellers.length)}</strong></div>
      <div class="guided-metric"><span>Different cards</span><strong>${escapeHtml(selectedCardGroups)}</strong></div>
      <div class="guided-metric"><span>Total copies</span><strong>${escapeHtml(totalCopies)}</strong></div>
      <div class="guided-metric"><span>Article value</span><strong>${escapeHtml(formatMoney(cardValue))}</strong></div>
      <div class="guided-metric muted-detail"><span>Shipping total</span><strong>${escapeHtml(formatEstimatedMoney(shippingTotal))}</strong></div>
      <div class="guided-metric muted-detail">
        <span>${escapeHtml(trusteeLabel)}</span>
        <strong>${escapeHtml(formatEstimatedMoney(trusteeTotal))}</strong>
        <small class="metric-note">${escapeHtml(trusteeNote)}</small>
      </div>
      ${SHIPPING_DATA_INCLUDES_CARDMARKET_FEE ? "" : `<div class="guided-metric muted-detail"><span>Cardmarket fees</span><strong>${escapeHtml(formatEstimatedMoney(feeTotal))}</strong></div>`}
    </div>
  `;
}

function recommendationsTemplate(result) {
  const planBySeller = groupSelectedOffersBySeller(result.selectedOffers);
  const costBySeller = new Map(result.sellerCosts.map((cost) => [cost.sellerIndex, cost]));
  const enrichedSelectedOffers = result.selectedOffers.map((offer) => enrichOfferWithReference(offer));
  const highPriceNote = hasHighPricedCards(enrichedSelectedOffers) ? generateHighPriceNote(enrichedSelectedOffers) : "";

  return `
    <div class="recommendations-header">
      <button class="ghost-button copy-plan-button" type="button" id="copyPlanButton">Copy buying plan</button>
    </div>
    ${highPriceNote}
    <div class="recommendation-grid">
      ${result.usedSellers.map(({ seller, sellerIndex }, displayIndex) => sellerPlanTemplate(seller, sellerIndex, displayIndex + 1, planBySeller.get(sellerIndex) || [], costBySeller.get(sellerIndex))).join("")}
    </div>
    <div class="drop-panel subdued-panel">
      <h3>Sellers not used</h3>
      ${result.droppedSellers.length
        ? `<p>${result.droppedSellers.map(({ seller }) => escapeHtml(seller.sellerName)).join(", ")}</p>`
        : "<p>Every parsed seller contributes to the current best result.</p>"}
    </div>
  `;
}

function warningBannerTemplate(result, warningEntries) {
  const criticalCount = warningEntries.filter((entry) => entry.severity === "critical").length;
  const warningCount = warningEntries.filter((entry) => entry.severity === "warning").length;
  const highestSeverity = criticalCount ? "critical" : warningCount ? "warning" : "info";

  const sectionTitle = criticalCount ? "Action required" : warningCount ? "Review before buying" : "Cost note";
  const sectionBody = criticalCount
    ? "Some seller costs or assignments could not be resolved. The buying plan may be incomplete."
    : warningCount
      ? "The buying plan is usable, but some costs are estimated. Verify the final Cardmarket checkout total before buying."
      : "All costs are estimated. Verify the final Cardmarket checkout total before buying.";

  return `
    <div class="result-warning severity-${escapeAttribute(highestSeverity)}">
      <div class="result-warning-header">
        <div class="result-warning-title-row">
          <h3 class="result-warning-title">${escapeHtml(sectionTitle)}</h3>
        </div>
        <p class="result-warning-body">${escapeHtml(sectionBody)}</p>
      </div>
      <details class="warning-details" ${criticalCount ? "open" : ""}>
        <summary>Show details</summary>
        <div class="warning-list">
          ${warningEntries.map((entry) => warningEntryTemplate(entry)).join("")}
        </div>
      </details>
      ${result.countryWarnings.length ? countryReviewTemplate(result.countryWarnings) : ""}
    </div>
  `;
}

function warningEntryTemplate(entry) {
  const pillClass = entry.severity === "critical" ? "warning" : entry.severity === "warning" ? "warning" : "info";
  return `
    <article class="warning-item severity-${escapeAttribute(entry.severity)}">
      <div class="warning-item-header">
        <strong>${escapeHtml(entry.title)}</strong>
        <span class="status-pill ${pillClass}">${escapeHtml(entry.severity)}</span>
      </div>
      ${entry.affected ? `<p class="warning-affected">Affects: ${escapeHtml(entry.affected)}</p>` : ""}
      <p>${escapeHtml(entry.whatHappened)}</p>
      <p><strong>Why it matters:</strong> ${escapeHtml(entry.whyItMatters)}</p>
      <p class="warning-action"><strong>What to do:</strong> ${escapeHtml(entry.whatToDo)}</p>
    </article>
  `;
}

function buildResultWarnings(result) {
  const entries = [];

  if (!Number.isFinite(result.selectedTotal)) {
    entries.push({
      severity: "critical",
      title: "Some selected seller costs could not be priced",
      affected: result.sellerCosts.filter((sellerCost) => !Number.isFinite(sellerCost.totalCost)).map((sellerCost) => sellerNameForCost(result, sellerCost)).join(", "),
      whatHappened: "The app could not find a valid dynamic shipping row for one or more selected sellers.",
      whyItMatters: "The optimized total may be too low or incomplete.",
      whatToDo: "Review the seller country and shipping method before buying."
    });
  }

  if (result.countryWarnings.length) {
    entries.push({
      severity: "warning",
      title: "Some seller country or shipping matches still need review",
      affected: result.countryWarnings.map(({ seller }) => seller.sellerName).join(", "),
      whatHappened: "The parser could not confidently match country or shipping for some selected sellers.",
      whyItMatters: "Shipping and trustee costs may be estimated from incomplete seller data.",
      whatToDo: "Open the warning details and confirm country and shipping before buying."
    });
  }

  if (result.insufficientGroups?.length) {
    entries.push({
      severity: "critical",
      title: "Some desired quantities cannot be fulfilled",
      affected: result.insufficientGroups.map((group) => group.cardName).join(", "),
      whatHappened: "The optimizer found fewer available copies than the reviewed desired quantity for one or more cards.",
      whyItMatters: "The buying plan is incomplete until those quantities are reduced or more seller offers are added.",
      whatToDo: "Adjust the desired quantity or find additional offers, then re-run optimization."
    });
  }

  const estimatedTrusteeSellers = result.sellerCosts.filter((sellerCost) => sellerCost.trusteeSource !== "parsed_exact");
  if (estimatedTrusteeSellers.length) {
    entries.push({
      severity: "info",
      title: "Some trustee fees are estimated",
      affected: estimatedTrusteeSellers.map((sellerCost) => sellerNameForCost(result, sellerCost)).join(", "),
      whatHappened: "The app used the trustee rule instead of an exact parsed trustee value for some selected sellers.",
      whyItMatters: "Final Cardmarket trustee fees may differ slightly when the optimized seller mix changes.",
      whatToDo: "Treat trustee as an estimate and verify the final checkout total on Cardmarket."
    });
  }

  if (result.warnings.some((warning) => /card group\(s\) had no single seller offer/i.test(warning))) {
    entries.push({
      severity: "warning",
      title: "Some cards had quantity coverage issues",
      affected: "",
      whatHappened: "At least one card did not have a single seller that covered the full reviewed quantity.",
      whyItMatters: "The plan may rely on fallback offer grouping rather than a clean one-seller quantity match.",
      whatToDo: "Review the card assignment details before buying."
    });
  }

  if (result.warnings.some((warning) => /Shipping table unavailable/i.test(warning))) {
    entries.push({
      severity: "critical",
      title: "Shipping table unavailable",
      affected: "All selected sellers",
      whatHappened: "The optimization could not load the shipping data table.",
      whyItMatters: "Shipping-sensitive totals may be incorrect.",
      whatToDo: "Reload the page with shipping data available before trusting the result."
    });
  }

  if (result.warnings.some((warning) => /50-iteration safety limit/i.test(warning))) {
    entries.push({
      severity: "info",
      title: "Optimization stopped at the safety limit",
      affected: "",
      whatHappened: "The move-based optimizer hit its iteration cap and then stopped.",
      whyItMatters: "The current plan may still be usable, but the search was not exhaustive.",
      whatToDo: "Treat the result as a strong candidate and review it before buying."
    });
  }

  return entries;
}

function sellerNameForCost(result, sellerCost) {
  return result.usedSellers.find((entry) => entry.sellerIndex === sellerCost.sellerIndex)?.seller?.sellerName || `Seller ${sellerCost.sellerIndex + 1}`;
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
    <div class="assumptions-list">
      ${result.sellerCosts.map((sellerCost) => assumptionsCardTemplate(result, sellerCost)).join("")}
    </div>
  `;
}

function assumptionsCardTemplate(result, sellerCost) {
  const seller = result.usedSellers.find((entry) => entry.sellerIndex === sellerCost.sellerIndex)?.seller;
  const shippingDebug = sellerCost.shippingDebug;
  const trusteeDebug = sellerCost.trusteeDebug;

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
        <li>Trustee: ${escapeHtml(trusteeDebug?.applies ? `${formatMoney(sellerCost.trusteeFeeValue)} at ${(trusteeDebug.rate * 100).toFixed(2)}%` : "Not applied")}</li>
        <li>Trustee source: ${escapeHtml(sellerCost.trusteeSourceLabel || "Estimated from trustee rule")}</li>
        <li>Trustee trigger: ${escapeHtml(trusteeDebug?.reason || "Not evaluated")}</li>
        <li>Cardmarket fee handling: ${escapeHtml(SHIPPING_DATA_INCLUDES_CARDMARKET_FEE ? "Included in shipping data" : "Added separately")}</li>
      </ul>
    </article>
  `;
}

function emptyStateBlockTemplate({ icon, title, body }) {
  return `
    <div class="empty-state-card">
      <div class="empty-state-icon" aria-hidden="true">${icon}</div>
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(body)}</p>
    </div>
  `;
}

function summaryEmptyState() {
  return emptyStateBlockTemplate({
    icon: ICON_CHART,
    title: "No optimization yet",
    body: "Paste your Cardmarket cart and click Optimize to see the cheapest seller mix."
  });
}

function recommendationsEmptyState() {
  return emptyStateBlockTemplate({
    icon: ICON_CART,
    title: "No buying plan yet",
    body: "Recommended sellers and assigned cards will appear here after optimization."
  });
}

function assignmentEmptyState() {
  return emptyStateBlockTemplate({
    icon: ICON_LIST,
    title: "No assignments yet",
    body: "The chosen seller for each card will be listed here after optimization."
  });
}

function assumptionsEmptyState() {
  return emptyStateBlockTemplate({
    icon: ICON_INFO,
    title: "No assumptions yet",
    body: "Shipping thresholds, selected methods, and calculation notes will appear here after optimization."
  });
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

function sellerPlanTemplate(seller, sellerIndex, displayNumber, offers, sellerCost) {
  const cardTotal = sellerCost?.articleValue ?? offerSubtotal(offers);
  const shippingTotal = sellerCost?.shippingValue ?? 0;
  const feeTotal = sellerCost?.cardmarketFeeValue ?? 0;
  const trusteeTotal = sellerCost?.trusteeFeeValue ?? 0;
  const fixedTotal = sellerCost?.totalCost ?? (shippingTotal + feeTotal + trusteeTotal);
  const displayTotal = Number.isFinite(fixedTotal) ? roundMoney(cardTotal + fixedTotal) : Number.POSITIVE_INFINITY;
  const shippingMethod = sellerCost?.shippingMethod || seller.shippingMethod || "Unknown shipping";
  const trackingLabel = sellerCost?.trackingStatus || seller.trackingStatus || "unknown";
  const shippingSourceClass = sellerCost?.source === "unresolved" ? "warning" : "good";
  const itemCount = offers.reduce((sum, offer) => sum + Number(offer.requiredQuantity || offer.quantity || 1), 0);
  const estimatedWeight = sellerCost?.estimatedWeight ?? estimateShipmentWeight(offers.length);

  return `
    <article class="recommendation-card premium-seller-card">
      <header class="seller-card-header">
        <div class="seller-number-badge">${escapeHtml(displayNumber)}</div>
        <div class="seller-info-primary">
          <h3>Buy from ${escapeHtml(seller.sellerName)}</h3>
          <div class="seller-meta">
            ${escapeHtml(seller.sellerCountry || "Unknown")} · ${escapeHtml(trackingLabel)} · ${escapeHtml(`${itemCount} card${itemCount === 1 ? "" : "s"}`)}
          </div>
        </div>
        <div class="seller-total">
          <strong>${escapeHtml(formatEstimatedMoney(displayTotal))}</strong>
        </div>
      </header>

      <div class="seller-cards-section">
        <div class="seller-section-label">Cards to buy</div>
        <table class="recommendation-table">
          <tbody>
            ${offers.map((offer) => recommendationOfferRowTemplate(offer)).join("")}
          </tbody>
        </table>
      </div>

      <div class="cost-breakdown">
        <div class="seller-section-label">Cost breakdown</div>
        <div class="breakdown-item">
          <span>Cards</span>
          <strong>${escapeHtml(formatMoney(cardTotal))}</strong>
        </div>
        <div class="breakdown-item">
          <span>Shipping</span>
          <strong>${escapeHtml(formatMoney(shippingTotal))}</strong>
        </div>
        <div class="breakdown-item">
          <span>Trustee</span>
          <strong>${escapeHtml(formatMoney(trusteeTotal))}</strong>
        </div>
        ${SHIPPING_DATA_INCLUDES_CARDMARKET_FEE ? "" : `
          <div class="breakdown-item">
            <span>Fees</span>
            <strong>${escapeHtml(formatMoney(feeTotal))}</strong>
          </div>
        `}
        <div class="breakdown-divider"></div>
        <div class="breakdown-item breakdown-total">
          <span>Total</span>
          <strong>${escapeHtml(formatEstimatedMoney(displayTotal))}</strong>
        </div>
      </div>

      <details class="shipping-detail-section">
        <summary class="shipping-detail-summary">
          Shipping · ${escapeHtml(shippingMethod)} · ${escapeHtml(trackingLabel)} · ~${escapeHtml(estimatedWeight)}g
        </summary>
        <div class="shipping-detail-body">
          <span class="status-pill ${shippingSourceClass} shipping-source-pill">${escapeHtml(sellerCost?.sourceLabel || "Original pasted shipping")}</span>
          ${sellerCost?.shippingDebug ? `
            <div class="shipping-debug ${sellerCost.shippingDebug.trackedRequired ? "tracked-required" : ""}">
              Order ${escapeHtml(formatMoney(sellerCost.shippingDebug.orderValue))} / ${escapeHtml(sellerCost.shippingDebug.cardCount)} card(s) / ${escapeHtml(`${sellerCost.shippingDebug.estimatedWeight}g`)}<br>
              Tracking required: <strong>${sellerCost.shippingDebug.trackedRequired ? "yes" : "no"}</strong><br>
              ${escapeHtml(sellerCost.shippingDebug.reason)}<br>
              ${Number.isFinite(sellerCost.shippingDebug.basePrice) ? `Base price: ${escapeHtml(formatMoney(sellerCost.shippingDebug.basePrice))}. ` : ""}
              ${sellerCost.shippingDebug.cardmarketFeeIncluded ? "Cardmarket fee included in shipping data." : ""}
            </div>
          ` : ""}
        </div>
      </details>
    </article>
  `;
}

function recommendationOfferRowTemplate(offer) {
  const referenceOffer = enrichOfferWithReference(offer);
  const referenceBadge = referenceOffer.hasReference
    ? `<span class="reference-delta-badge delta-${escapeAttribute(referenceOffer.deltaColor)}" title="${escapeAttribute(referenceDeltaTitle(referenceOffer, getReferenceData(offer.cardName)))}">${escapeHtml(referenceOffer.deltaDisplay)}</span>`
    : "";
  const referenceHint = referenceOffer.hasReference
    ? `<div class="reference-inline-note">Scryfall ref ${escapeHtml(formatReferenceMoney(referenceOffer.referencePrice, referenceOffer.referenceCurrency))}</div>`
    : state.scryallLookupInProgress
      ? `<div class="reference-inline-note">Scryfall loading...</div>`
      : "";

  return `
    <tr>
      <td>${escapeHtml(offer.requiredQuantity || offer.quantity)}×</td>
      <td>
        ${escapeHtml(offer.cardName)}
        ${referenceHint}
      </td>
      <td class="condition-cell">${escapeHtml(offer.condition)}</td>
      <td class="price-cell">
        <span class="price-with-reference">${escapeHtml(formatMoney(offer.unitPrice))}${referenceBadge}</span>
      </td>
    </tr>
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

function getReferenceData(cardName) {
  return state.priceReferences[normalizeReferenceKey(cardName)] || null;
}

function normalizeReferenceKey(cardName) {
  return String(cardName || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function formatReferenceMoney(price, currency = "EUR") {
  if (!Number.isFinite(Number(price))) {
    return "Unavailable";
  }

  return currency === "EUR"
    ? formatMoney(price)
    : `${currency} ${Number(price).toFixed(2)}`;
}

function referenceSourceIcon(referenceData) {
  if (!referenceData || referenceData.error) {
    return "";
  }

  return `<span class="reference-price-icon" title="${escapeAttribute(`${referenceData.source} reference price`)}" aria-label="${escapeAttribute(`${referenceData.source} reference price`)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><path d="M12 8h.01"></path><path d="M11 12h1v4h1"></path></svg></span>`;
}

function referenceErrorLabel(reason) {
  switch (reason) {
    case "no_price_available":
      return "Scryfall found the card but returned no market price.";
    case "not_found":
      return "Scryfall could not find this card name.";
    case "timeout":
      return "Scryfall lookup timed out.";
    case "network_error":
      return "Scryfall lookup failed because the network request did not complete.";
    default:
      return "Scryfall reference price is unavailable.";
  }
}

function enrichOfferWithReference(offer) {
  return enrichCardWithReference(offer, getReferenceData(offer.cardName));
}

function referenceDeltaTitle(referenceCard, referenceData) {
  if (!referenceCard?.hasReference || !referenceData || referenceData.error) {
    return "Scryfall reference unavailable";
  }

  return `${formatMoney(referenceCard.price)} vs ${formatReferenceMoney(referenceData.price, referenceData.currency)} from ${referenceData.source}`;
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

async function copyBuyingPlan(result) {
  const planBySeller = groupSelectedOffersBySeller(result.selectedOffers);
  const costBySeller = new Map(result.sellerCosts.map((cost) => [cost.sellerIndex, cost]));

  const lines = result.usedSellers.map(({ seller, sellerIndex }) => {
    const offers = planBySeller.get(sellerIndex) || [];
    const cost = costBySeller.get(sellerIndex);
    const totalCost = cost?.totalCost ?? offerSubtotal(offers);
    const shippingCost = cost?.shippingValue ?? 0;
    const cardLines = offers.map((offer) =>
      `  - ${offer.requiredQuantity || offer.quantity}× ${offer.cardName} — ${offer.condition} — ${formatMoney(offer.unitPrice)}`
    ).join("\n");
    return `Buy from ${seller.sellerName}\n${cardLines}\nShipping: ${formatMoney(shippingCost)}\nTotal: ${formatEstimatedMoney(totalCost)}`;
  });

  const text = lines.join("\n\n");
  const btn = document.querySelector("#copyPlanButton");

  try {
    await navigator.clipboard.writeText(text);
    if (btn) {
      btn.textContent = "Copied!";
      setTimeout(() => { btn.textContent = "Copy buying plan"; }, 2000);
    }
  } catch {
    if (btn) {
      btn.textContent = "Copy failed";
      setTimeout(() => { btn.textContent = "Copy buying plan"; }, 2000);
    }
  }
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

function getTotalCopies(offerGroups) {
  return offerGroups.reduce((sum, group) => sum + group.requiredQuantity, 0);
}

function normalizeOfferKey(cardName) {
  return String(cardName || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function exactParsedTrusteeValue(seller, articleValue, quantity, shippingMethod, tracked) {
  const parsedTrusteeValue = Number(seller.trusteeValue);
  if (!Number.isFinite(parsedTrusteeValue)) {
    return null;
  }

  const parsedArticleValue = Number(seller.articleValue);
  const parsedQuantity = seller.items.reduce((sum, item) => sum + Number(item.quantity || 1), 0);
  if (Math.abs(parsedArticleValue - articleValue) > 0.005 || parsedQuantity !== quantity) {
    return null;
  }

  const parsedMethod = normalizeMethodForComparison(seller.shippingMethod);
  const selectedMethod = normalizeMethodForComparison(shippingMethod);
  if (parsedMethod && selectedMethod && parsedMethod !== selectedMethod) {
    return null;
  }

  const parsedTracked = seller.trackingStatus || "unknown";
  const selectedTracked = tracked ? "tracked" : "untracked";
  if (parsedTracked !== "unknown" && parsedTracked !== selectedTracked) {
    return null;
  }

  return roundMoney(parsedTrusteeValue);
}

export const __testing = {
  state,
  buildOfferGroups,
  buildResultWarnings,
  desiredCardsTableTemplate,
  getTotalCopies,
  groupSelectedOffersBySeller,
  normalizeReferenceKey,
  optimizeCart,
  optimizationSummaryTemplate,
  recommendationOfferRowTemplate,
  sellerPlanTemplate,
  warningBannerTemplate
};

function normalizeMethodForComparison(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\bmax weight\b.*$/i, "")
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
