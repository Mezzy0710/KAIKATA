/**
 * Communication bridge with the CartForge browser extension
 */

/**
 * Send a confirmed buying plan back to the extension
 * @param {object} plan - Confirmed plan from buildConfirmedPlan
 * @returns {Promise<object>} Result of sending the plan
 */
export async function sendConfirmedPlanToExtension(plan) {
  if (!plan) {
    return { ok: false, error: "No plan provided" };
  }

  // Check if extension is available
  if (!window.opener && !window.parent || typeof window.__cartforgeExtension === "undefined") {
    return {
      ok: false,
      error: "Extension not available. Copy the buying plan manually or re-import from the extension."
    };
  }

  try {
    // Attempt to post message to extension
    if (window.opener && typeof window.opener.postMessage === "function") {
      window.opener.postMessage(
        {
          type: "CARTFORGE_CONFIRMED_PLAN",
          payload: plan
        },
        "*"
      );
      return { ok: true, message: "Plan sent to extension" };
    }

    return {
      ok: false,
      error: "Unable to communicate with extension window"
    };
  } catch (error) {
    return {
      ok: false,
      error: `Failed to send plan: ${error.message}`
    };
  }
}
