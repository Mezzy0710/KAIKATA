/**
 * Escape HTML special characters for safe DOM rendering
 * @param {string} value - Text to escape
 * @returns {string} Escaped text safe for innerHTML
 */
export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Escape HTML for use in attribute values
 * @param {string} value - Value to escape
 * @returns {string} Escaped value safe for attributes
 */
export function escapeAttribute(value) {
  return escapeHtml(value);
}
