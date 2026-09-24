// Where KAIKATA runs: as an extension page (chrome-extension://…/app/index.html, packaged by
// scripts/package-extension.mjs) or as the website (GitHub Pages, localhost, Node tests).
// app.mjs talks to the extension only through this module.
//
//   extension host → reads and writes chrome.storage.local directly
//   web host       → URL hash (cart) + postMessage bridge (src/extension-bridge.mjs)
//
// createHost() takes its transports as arguments so tests can pass a fake chrome.storage.
import { decodeCartForgeHash } from "./importer.mjs?v=20260927a";
import { requestCandidatesFromExtension, sendConfirmedPlanToExtension } from "./extension-bridge.mjs?v=20260927a";

export const INCOMING_CART_KEY = "cartforgeIncomingCartV1";
export const CANDIDATES_KEY = "cartforgeCandidatesV1";
export const CONFIRMED_PLAN_KEY = "cartforgeConfirmedPlanV3";
// Same values as extension/background.js.
export const PLAN_TTL_MS = 24 * 60 * 60 * 1000;
export const SUPPORTED_PLAN_SCHEMA_VERSIONS = [1, 2];

export function detectExtensionHost(scope = globalThis) {
  return scope.location?.protocol === "chrome-extension:" && !!scope.chrome?.storage;
}

// Mirror of validateConfirmedPlan in extension/background.js (tests/host.mjs keeps them in step).
export function validateConfirmedPlan(plan) {
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

// flow: globalThis.CartforgeWantsFlow (extension/cartforge-wants-flow.js). The packaged
// index.html loads it as a classic script before app.mjs, so the filter has one implementation.
export function createExtensionHost({ chrome, flow, now = () => Date.now() }) {
  const storage = chrome.storage.local;

  async function loadIncomingCart() {
    const stored = await storage.get(INCOMING_CART_KEY);
    const entry = stored?.[INCOMING_CART_KEY];
    if (!entry) return null;
    await storage.remove(INCOMING_CART_KEY);
    return entry.payload && typeof entry.payload === "object" ? entry.payload : null;
  }

  // Same filter and response shape as CARTFORGE_V3_GET_CANDIDATES in background.js.
  async function getCandidates({ wantsListIds } = {}) {
    if (!flow?.filterCapturesForTransfer) {
      return { ok: false, error: "Wants-stock helpers are not loaded." };
    }
    const stored = await storage.get(CANDIDATES_KEY);
    const transfer = flow.filterCapturesForTransfer(
      stored?.[CANDIDATES_KEY] || {},
      Array.isArray(wantsListIds) ? wantsListIds.map(String) : [],
      now()
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

  // Same envelope and result as storeConfirmedPlan in background.js.
  async function storeConfirmedPlan(plan) {
    const validation = validateConfirmedPlan(plan);
    if (!validation.ok) return validation;
    const time = now();
    const storedAt = new Date(time).toISOString();
    const expiresAt = new Date(time + PLAN_TTL_MS).toISOString();
    try {
      await storage.set({ [CONFIRMED_PLAN_KEY]: { plan, storedAt, expiresAt } });
    } catch (error) {
      return { ok: false, error: error?.message || "Could not store confirmed plan." };
    }
    return { ok: true, optimizationSessionId: plan.optimizationSessionId, storedAt, expiresAt };
  }

  function onStorageKey(key, callback) {
    const listener = (changes, areaName) => {
      if (areaName === "local" && changes?.[key]) callback(changes[key]);
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }

  // Wants pages write captures in another tab; this tab hears it without a focus change.
  // A page walk writes several times in a row, so wait until the writes settle.
  function onCandidatesChanged(callback, settleMs = 250) {
    let timer = null;
    return onStorageKey(CANDIDATES_KEY, () => {
      clearTimeout(timer);
      timer = setTimeout(callback, settleMs);
    });
  }

  // "Transfer to KAIKATA" while this tab is already open. Our own remove() also fires a
  // change (without newValue); that one is ignored.
  function onIncomingCart(callback) {
    return onStorageKey(INCOMING_CART_KEY, (change) => {
      if (change.newValue) callback();
    });
  }

  return { kind: "extension", loadIncomingCart, getCandidates, storeConfirmedPlan, onCandidatesChanged, onIncomingCart };
}

export function createWebHost({ window: win = globalThis.window, document: doc = globalThis.document } = {}) {
  async function loadIncomingCart() {
    if (!win?.location) return null;
    const decoded = decodeCartForgeHash(win.location.hash);
    if (!decoded.ok) return null;
    win.history?.replaceState(null, "", win.location.pathname + win.location.search);
    return decoded.payload;
  }

  function getCandidates({ wantsListIds } = {}) {
    return requestCandidatesFromExtension({ wantsListIds: wantsListIds || [] });
  }

  function storeConfirmedPlan(plan) {
    return sendConfirmedPlanToExtension(plan);
  }

  // Captures happen in another tab, so re-check when the user comes back to this one.
  function onCandidatesChanged(callback) {
    if (!doc?.addEventListener) return () => {};
    const listener = () => {
      if (doc.visibilityState === "visible") callback();
    };
    doc.addEventListener("visibilitychange", listener);
    return () => doc.removeEventListener("visibilitychange", listener);
  }

  // A new cart on the website arrives as a new tab with a URL hash.
  function onIncomingCart() {
    return () => {};
  }

  return { kind: "web", loadIncomingCart, getCandidates, storeConfirmedPlan, onCandidatesChanged, onIncomingCart };
}

export function createHost(scope = globalThis) {
  return detectExtensionHost(scope)
    ? createExtensionHost({ chrome: scope.chrome, flow: scope.CartforgeWantsFlow })
    : createWebHost({ window: scope.window, document: scope.document });
}

export const host = createHost();
