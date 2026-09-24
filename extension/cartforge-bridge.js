(() => {
  const STORE_REQUEST = "CARTFORGE_V3_STORE_CONFIRMED_PLAN";
  const STORE_RESPONSE = "CARTFORGE_V3_STORE_CONFIRMED_PLAN_RESULT";
  const CANDIDATES_REQUEST = "CARTFORGE_V3_GET_CANDIDATES";
  const CANDIDATES_RESPONSE = "CARTFORGE_V3_GET_CANDIDATES_RESULT";

  async function relay(request, responseType, requestId) {
    let response;
    try {
      response = await chrome.runtime.sendMessage(request);
    } catch (error) {
      response = { ok: false, error: error.message || "Extension bridge failed." };
    }
    window.postMessage({ type: responseType, requestId: requestId || "", response }, window.location.origin);
  }

  window.addEventListener("message", async (event) => {
    if (event.source !== window || event.origin !== window.location.origin) {
      return;
    }

    const message = event.data;
    if (message?.type === CANDIDATES_REQUEST) {
      relay({ type: CANDIDATES_REQUEST }, CANDIDATES_RESPONSE, message.requestId);
      return;
    }
    if (!message || message.type !== STORE_REQUEST) {
      return;
    }

    try {
      const response = await chrome.runtime.sendMessage({
        type: STORE_REQUEST,
        plan: message.plan
      });
      window.postMessage({
        type: STORE_RESPONSE,
        requestId: message.requestId || "",
        response
      }, window.location.origin);
    } catch (error) {
      window.postMessage({
        type: STORE_RESPONSE,
        requestId: message.requestId || "",
        response: {
          ok: false,
          error: error.message || "Extension bridge failed."
        }
      }, window.location.origin);
    }
  });
})();
