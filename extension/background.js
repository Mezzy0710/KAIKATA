// Pure wants-stock helpers (classic service worker → globalThis.CartforgeWantsFlow).
importScripts("cartforge-wants-flow.js");

const PLAN_STORAGE_KEY = "cartforgeConfirmedPlanV3";
const PLAN_TTL_MS = 24 * 60 * 60 * 1000;
// v2 adds "add" rows (wants-page offers); v1 plans from older KAIKATA builds still work.
const SUPPORTED_PLAN_SCHEMA_VERSIONS = [1, 2];
const CANDIDATES_STORAGE_KEY = "cartforgeCandidatesV1";

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") {
    return false;
  }

  if (message.type === "CARTFORGE_V3_STORE_CONFIRMED_PLAN") {
    storeConfirmedPlan(message.plan)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, error: error.message || "Could not store confirmed plan." }));
    return true;
  }

  if (message.type === "CARTFORGE_V3_GET_CONFIRMED_PLAN") {
    getConfirmedPlan()
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, error: error.message || "Could not read confirmed plan." }));
    return true;
  }

  if (message.type === "CARTFORGE_V3_GET_CANDIDATES") {
    getCandidates(message.wantsListIds)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, error: error.message || "Could not read captured offers." }));
    return true;
  }

  if (message.type === "CARTFORGE_V3_CLEAR_CONFIRMED_PLAN") {
    chrome.storage.local.remove(PLAN_STORAGE_KEY)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message || "Could not clear confirmed plan." }));
    return true;
  }

  return false;
});

async function storeConfirmedPlan(plan) {
  const validation = validateConfirmedPlan(plan);
  if (!validation.ok) {
    return validation;
  }

  const storedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + PLAN_TTL_MS).toISOString();
  await chrome.storage.local.set({
    [PLAN_STORAGE_KEY]: {
      plan,
      storedAt,
      expiresAt
    }
  });

  return {
    ok: true,
    optimizationSessionId: plan.optimizationSessionId,
    storedAt,
    expiresAt
  };
}

async function getConfirmedPlan() {
  const stored = await chrome.storage.local.get(PLAN_STORAGE_KEY);
  const envelope = stored[PLAN_STORAGE_KEY];
  if (!envelope?.plan) {
    return { ok: true, plan: null };
  }

  if (Date.parse(envelope.expiresAt) <= Date.now()) {
    await chrome.storage.local.remove(PLAN_STORAGE_KEY);
    return { ok: true, plan: null, expired: true };
  }

  return {
    ok: true,
    plan: envelope.plan,
    storedAt: envelope.storedAt,
    expiresAt: envelope.expiresAt
  };
}

function validateConfirmedPlan(plan) {
  if (!plan || typeof plan !== "object") {
    return { ok: false, error: "Confirmed plan is missing." };
  }
  if (!SUPPORTED_PLAN_SCHEMA_VERSIONS.includes(plan.schemaVersion)) {
    return { ok: false, error: "Unsupported confirmed-plan schema version." };
  }
  if (!plan.optimizationSessionId || typeof plan.optimizationSessionId !== "string") {
    return { ok: false, error: "Confirmed plan is missing an optimization session ID." };
  }
  if (!plan.cartFingerprint || typeof plan.cartFingerprint !== "string") {
    return { ok: false, error: "Confirmed plan is missing a cart fingerprint." };
  }
  if (!Array.isArray(plan.sellers) || !Array.isArray(plan.rows)) {
    return { ok: false, error: "Confirmed plan seller or row data is invalid." };
  }
  return { ok: true };
}

// Wants-page captures, keyed by normalized seller name (see wants-page.js). Only captures
// < 24 h old from the imported cart's wants list(s) go to KAIKATA; the rest are counted.
// Without wantsListIds (older KAIKATA, pasted cart) only the age rule applies.
async function getCandidates(wantsListIds) {
  const stored = await chrome.storage.local.get(CANDIDATES_STORAGE_KEY);
  const transfer = globalThis.CartforgeWantsFlow.filterCapturesForTransfer(
    stored[CANDIDATES_STORAGE_KEY] || {},
    Array.isArray(wantsListIds) ? wantsListIds : []
  );
  const sellers = transfer.sellers.map((entry) => ({
    sellerName: entry.sellerName,
    sellerCountry: entry.sellerCountry || "",
    wantsListId: entry.wantsListId || "",
    capturedAt: entry.capturedAt,
    stale: false,
    offers: entry.offers
  }));
  return { ok: true, sellers, excluded: transfer.excluded, fallback: transfer.fallback };
}
