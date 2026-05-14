export const STORE_CONFIRMED_PLAN_REQUEST = "CARTFORGE_V3_STORE_CONFIRMED_PLAN";
export const STORE_CONFIRMED_PLAN_RESPONSE = "CARTFORGE_V3_STORE_CONFIRMED_PLAN_RESULT";

export function createStoreConfirmedPlanMessage(plan, requestId = createBridgeRequestId()) {
  return {
    type: STORE_CONFIRMED_PLAN_REQUEST,
    requestId,
    plan
  };
}

export async function sendConfirmedPlanToExtension(plan, options = {}) {
  const targetWindow = options.targetWindow || globalThis.window;
  const targetOrigin = options.targetOrigin || targetWindow?.location?.origin;
  const timeoutMs = options.timeoutMs ?? 1500;
  const request = createStoreConfirmedPlanMessage(plan, options.requestId);

  if (!targetWindow || typeof targetWindow.postMessage !== "function" || !targetOrigin) {
    return {
      ok: false,
      error: "CartForge extension bridge is unavailable in this environment."
    };
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
      if (!isStoreConfirmedPlanResponse(event, request.requestId, targetWindow, targetOrigin)) {
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
  return event?.source === targetWindow
    && event?.origin === targetOrigin
    && event?.data?.type === STORE_CONFIRMED_PLAN_RESPONSE
    && event?.data?.requestId === requestId;
}

function createBridgeRequestId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `bridge_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}
