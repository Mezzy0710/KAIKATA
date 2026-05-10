/**
 * Popup script - handles UI and user interactions
 */

import { formatCartForDisplay, validateCart } from './extractor.mjs';

/**
 * Request extraction from content script
 */
async function requestExtraction() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tab.id, { action: 'extractCart' }, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ success: false, error: chrome.runtime.lastError.message });
      } else {
        resolve(response);
      }
    });
  });
}

/**
 * Copy data to clipboard
 */
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return { success: true };
  } catch (error) {
    console.error('[CartForge] Clipboard copy failed:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Format cart data for copying (JSON format for CartForge parser)
 */
function formatCartJSON(cartData) {
  if (!cartData.success) {
    return JSON.stringify({ success: false, errors: cartData.errors });
  }

  return JSON.stringify({
    success: true,
    sellers: cartData.sellers,
    extractedAt: cartData.extractedAt,
    source: 'cartforgeExtension'
  }, null, 2);
}

/**
 * Display extraction results in popup
 */
function displayResults(cartData) {
  const container = document.getElementById('results');
  const errorContainer = document.getElementById('errors');
  const copyBtn = document.getElementById('copyButton');

  // Clear previous content
  container.innerHTML = '';
  errorContainer.innerHTML = '';

  if (!cartData.success) {
    // Show errors
    errorContainer.innerHTML = `
      <div class="error-box">
        <p class="error-title">⚠️ Extraction failed</p>
        <p class="error-message">${cartData.errors.join('<br>')}</p>
        <p class="error-hint">Make sure you're on a Cardmarket cart page and it has fully loaded.</p>
      </div>
    `;
    copyBtn.disabled = true;
    return;
  }

  // Show success
  const display = formatCartForDisplay(cartData);
  const validation = validateCart(cartData);

  container.innerHTML = `
    <div class="success-box">
      <div class="summary">
        <span class="summary-text">${display.summary}</span>
        <span class="timestamp">${new Date().toLocaleTimeString()}</span>
      </div>

      <div class="sellers-list">
        <p class="label">Sellers detected:</p>
        <ul>
          ${display.sellers.map(s => `
            <li>
              <strong>${s.name}</strong>
              <span class="seller-meta">${s.country} · ${s.itemCount} item${s.itemCount !== 1 ? 's' : ''}</span>
            </li>
          `).join('')}
        </ul>
      </div>

      ${validation.issues.length > 0 ? `
        <div class="warning-box">
          <p class="warning-title">⚠️ Issues detected:</p>
          <ul class="issue-list">
            ${validation.issues.slice(0, 3).map(issue => `<li>${issue}</li>`).join('')}
            ${validation.issues.length > 3 ? `<li>... and ${validation.issues.length - 3} more</li>` : ''}
          </ul>
        </div>
      ` : ''}
    </div>
  `;

  copyBtn.disabled = false;
  copyBtn.onclick = () => handleCopy(cartData);
}

/**
 * Handle copy button click
 */
async function handleCopy(cartData) {
  const copyBtn = document.getElementById('copyButton');
  const jsonText = formatCartJSON(cartData);

  copyBtn.disabled = true;
  copyBtn.textContent = 'Copying...';

  const result = await copyToClipboard(jsonText);

  if (result.success) {
    copyBtn.textContent = '✓ Copied!';
    setTimeout(() => {
      copyBtn.textContent = '📋 Copy to Clipboard';
      copyBtn.disabled = false;
    }, 2000);
  } else {
    copyBtn.textContent = '✗ Copy failed';
    setTimeout(() => {
      copyBtn.textContent = '📋 Copy to Clipboard';
      copyBtn.disabled = false;
    }, 2000);
  }
}

/**
 * Initialize popup
 */
async function initializePopup() {
  const extractBtn = document.getElementById('extractButton');
  const copyBtn = document.getElementById('copyButton');
  const loadingEl = document.getElementById('loading');
  const resultsEl = document.getElementById('results');

  // Show loading state
  loadingEl.style.display = 'flex';
  resultsEl.innerHTML = '';

  // Request extraction
  extractBtn.disabled = true;
  extractBtn.textContent = 'Extracting...';

  const response = await requestExtraction();

  loadingEl.style.display = 'none';
  extractBtn.disabled = false;
  extractBtn.textContent = 'Re-extract Cart';

  if (!response) {
    document.getElementById('errors').innerHTML = `
      <div class="error-box">
        <p class="error-title">⚠️ Communication failed</p>
        <p class="error-message">Could not communicate with content script. Make sure you're on a Cardmarket page.</p>
      </div>
    `;
  } else {
    displayResults(response.data || response);
  }
}

/**
 * Set up event listeners
 */
document.addEventListener('DOMContentLoaded', () => {
  const extractBtn = document.getElementById('extractButton');
  const openCartForgeBtn = document.getElementById('openCartForge');

  extractBtn.addEventListener('click', initializePopup);

  openCartForgeBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://cartforge.github.io' });
  });

  // Trigger initial extraction on popup open
  initializePopup();
});
