const PLAN_STORAGE_KEY = "cartforgeConfirmedPlanV3";
const PLAN_TTL_MS = 24 * 60 * 60 * 1000;

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
  if (plan.schemaVersion !== 1) {
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
