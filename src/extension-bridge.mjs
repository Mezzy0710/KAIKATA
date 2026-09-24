export const STORE_CONFIRMED_PLAN_REQUEST = "CARTFORGE_V3_STORE_CONFIRMED_PLAN";
export const STORE_CONFIRMED_PLAN_RESPONSE = "CARTFORGE_V3_STORE_CONFIRMED_PLAN_RESULT";
export const GET_CANDIDATES_REQUEST = "CARTFORGE_V3_GET_CANDIDATES";
export const GET_CANDIDATES_RESPONSE = "CARTFORGE_V3_GET_CANDIDATES_RESULT";

export function createStoreConfirmedPlanMessage(plan, requestId = createBridgeRequestId()) {
  return {
    type: STORE_CONFIRMED_PLAN_REQUEST,
    requestId,
    plan
  };
}

export function sendConfirmedPlanToExtension(plan, options = {}) {
  return bridgeRequest(createStoreConfirmedPlanMessage(plan, options.requestId), STORE_CONFIRMED_PLAN_RESPONSE, options);
}

// Wants-page offers captured by the extension. Sent through postMessage (not the URL
// hash) because captures can hold thousands of rows. Without the extension this
// resolves to { ok: false } after the timeout and KAIKATA works as before.
export function requestCandidatesFromExtension(options = {}) {
  return bridgeRequest(
    { type: GET_CANDIDATES_REQUEST, requestId: options.requestId || createBridgeRequestId() },
    GET_CANDIDATES_RESPONSE,
    options
  );
}

function bridgeRequest(request, responseType, options = {}) {
  const targetWindow = options.targetWindow || globalThis.window;
  const targetOrigin = options.targetOrigin || targetWindow?.location?.origin;
  const timeoutMs = options.timeoutMs ?? 1500;

  if (!targetWindow || typeof targetWindow.postMessage !== "function" || !targetOrigin) {
    return Promise.resolve({
      ok: false,
      error: "CartForge extension bridge is unavailable in this environment."
    });
  }

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve({
        ok: false,
        error: "CartForge extension did not respond."
      });
    }, timeoutMs);

    function onMessage(event) {
      if (!isBridgeResponse(event, responseType, request.requestId, targetWindow, targetOrigin)) {
        return;
      }
      cleanup();
      resolve(event.data.response || {
        ok: false,
        error: "CartForge extension returned an empty response."
      });
    }

    function cleanup() {
      clearTimeout(timer);
      targetWindow.removeEventListener("message", onMessage);
    }

    targetWindow.addEventListener("message", onMessage);
    targetWindow.postMessage(request, targetOrigin);
  });
}

export function isStoreConfirmedPlanResponse(event, requestId, targetWindow, targetOrigin) {
  return isBridgeResponse(event, STORE_CONFIRMED_PLAN_RESPONSE, requestId, targetWindow, targetOrigin);
}

function isBridgeResponse(event, responseType, requestId, targetWindow, targetOrigin) {
  return event?.source === targetWindow
    && event?.origin === targetOrigin
    && event?.data?.type === responseType
    && event?.data?.requestId === requestId;
}

function createBridgeRequestId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `bridge_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}
