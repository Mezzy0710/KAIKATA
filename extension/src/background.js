/**
 * Service worker for CartForge extension
 * Minimal background script for MV3 compliance
 */

// Listen for extension installation
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('[CartForge] Extension installed');
    // Could open welcome page here in v1.1
  }
});

// Simple logging for debugging
console.log('[CartForge] Service worker initialized');
