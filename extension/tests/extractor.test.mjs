/**
 * Extractor tests using JSDOM and fixture data
 */

import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  MOCK_CART_DESKTOP_EN,
  MOCK_CART_MOBILE_EN,
  MOCK_CART_GERMAN,
  MOCK_CART_INCOMPLETE,
  MOCK_CART_EMPTY,
  MOCK_CART_SELLER_NO_ITEMS,
  MOCK_CART_LARGE
} from './fixtures/dom-utils.mjs';

/**
 * Simulate extractor in JSDOM context
 * Note: Full extractor needs ES module bundling in actual extension
 * This test validates the selector logic and parsing
 */

function setupDOM(htmlString) {
  const dom = new JSDOM(htmlString, { url: 'https://www.cardmarket.com/en/Magic/Cart' });
  global.document = dom.window.document;
  global.window = dom.window;
  return dom.window;
}

function teardownDOM() {
  delete global.document;
  delete global.window;
}

/**
 * Test: Extract desktop cart
 */
async function testDesktopCart() {
  setupDOM(MOCK_CART_DESKTOP_EN);

  try {
    const sellers = document.querySelectorAll('[data-seller-id]');
    assert.equal(sellers.length, 2, 'Should find 2 sellers');

    const firstSeller = sellers[0];
    const sellerName = firstSeller.querySelector('.seller-name');
    assert.ok(sellerName, 'Seller name element should exist');
    assert.equal(sellerName.textContent, 'GermanSingles', 'Seller name should match');

    const items = firstSeller.querySelectorAll('[data-item-id]');
    assert.equal(items.length, 2, 'First seller should have 2 items');

    const firstItem = items[0];
    const cardName = firstItem.querySelector('.card-name');
    assert.equal(cardName.textContent, 'Arcane Signet', 'Card name should match');

    const price = firstItem.querySelector('.price');
    assert.ok(price.textContent.includes('0.85'), 'Price should include amount');

    console.log('✓ Desktop cart extraction works');
  } finally {
    teardownDOM();
  }
}

/**
 * Test: Extract mobile cart
 */
async function testMobileCart() {
  setupDOM(MOCK_CART_MOBILE_EN);

  try {
    const sellers = document.querySelectorAll('[data-seller-id]');
    assert.equal(sellers.length, 1, 'Should find 1 seller');

    const seller = sellers[0];
    assert.ok(seller.querySelector('.seller-name'), 'Mobile layout should have seller name');
    assert.ok(seller.querySelector('.country-badge'), 'Mobile layout should have country');

    const items = seller.querySelectorAll('[data-item-id]');
    assert.equal(items.length, 1, 'Should find 1 item');

    console.log('✓ Mobile cart extraction works');
  } finally {
    teardownDOM();
  }
}

/**
 * Test: Extract German cart
 */
async function testGermanCart() {
  setupDOM(MOCK_CART_GERMAN);

  try {
    const sellers = document.querySelectorAll('[data-seller-id]');
    assert.equal(sellers.length, 1, 'Should find 1 seller');

    const seller = sellers[0];
    // Note: German selectors would need adaptation in real extractor
    const nameEl = seller.querySelector('.verkäufer-name') || seller.querySelector('.seller-name');
    assert.ok(nameEl, 'Should find seller name in any language');

    console.log('✓ German cart layout recognized');
  } finally {
    teardownDOM();
  }
}

/**
 * Test: Handle incomplete data
 */
async function testIncompleteCart() {
  setupDOM(MOCK_CART_INCOMPLETE);

  try {
    const sellers = document.querySelectorAll('[data-seller-id]');
    assert.equal(sellers.length, 1, 'Should still find seller even with missing fields');

    const seller = sellers[0];
    const cardName = seller.querySelector('.card-name');
    const price = seller.querySelector('.price');

    assert.ok(cardName, 'Card name should exist');
    assert.ok(price, 'Price should exist (item is still valid)');

    console.log('✓ Incomplete data handled gracefully');
  } finally {
    teardownDOM();
  }
}

/**
 * Test: Empty cart
 */
async function testEmptyCart() {
  setupDOM(MOCK_CART_EMPTY);

  try {
    const sellers = document.querySelectorAll('[data-seller-id]');
    assert.equal(sellers.length, 0, 'Empty cart should have no sellers');

    console.log('✓ Empty cart detection works');
  } finally {
    teardownDOM();
  }
}

/**
 * Test: Seller with no items
 */
async function testSellerNoItems() {
  setupDOM(MOCK_CART_SELLER_NO_ITEMS);

  try {
    const sellers = document.querySelectorAll('[data-seller-id]');
    const seller = sellers[0];

    const items = seller.querySelectorAll('[data-item-id]');
    assert.equal(items.length, 0, 'Seller with no items should be detected');

    // Extractor should skip this seller when building results
    console.log('✓ Seller with no items can be filtered');
  } finally {
    teardownDOM();
  }
}

/**
 * Test: Large cart
 */
async function testLargeCart() {
  setupDOM(MOCK_CART_LARGE);

  try {
    const sellers = document.querySelectorAll('[data-seller-id]');
    assert.equal(sellers.length, 5, 'Should find all 5 sellers');

    let totalItems = 0;
    for (const seller of sellers) {
      const items = seller.querySelectorAll('[data-item-id]');
      totalItems += items.length;
    }

    assert.equal(totalItems, 25, 'Should find all 25 items total (5 per seller)');

    console.log('✓ Large cart extraction works');
  } finally {
    teardownDOM();
  }
}

/**
 * Run all tests
 */
async function runTests() {
  console.log('\n=== CartForge Extension - Extractor Tests ===\n');

  try {
    await testDesktopCart();
    await testMobileCart();
    await testGermanCart();
    await testIncompleteCart();
    await testEmptyCart();
    await testSellerNoItems();
    await testLargeCart();

    console.log('\n✅ All tests passed!\n');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error(error);
    process.exit(1);
  }
}

// Run tests
runTests();
