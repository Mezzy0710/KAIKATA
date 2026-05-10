/**
 * DOM utilities for testing
 * Provides JSDOM setup and fixture data
 */

/**
 * Mock Cardmarket cart page - Desktop English layout
 */
export const MOCK_CART_DESKTOP_EN = `
<!DOCTYPE html>
<html>
<head>
  <title>Shopping Cart</title>
</head>
<body>
  <div class="cart-container">
    <div data-seller-id="123">
      <div class="seller-name">GermanSingles</div>
      <div class="country-badge">Germany</div>
      <div class="shipping-method">DHL - €5.50</div>

      <table>
        <tbody>
          <tr data-item-id="1">
            <td class="card-name">Arcane Signet</td>
            <td class="condition">Near Mint</td>
            <td><input type="number" class="qty-input" value="2" data-quantity="1"></td>
            <td class="price">€0.85</td>
          </tr>
          <tr data-item-id="2">
            <td class="card-name">Sol Ring</td>
            <td class="condition">Played</td>
            <td><input type="number" class="qty-input" value="1" data-quantity="1"></td>
            <td class="price">€15.50</td>
          </tr>
        </tbody>
      </table>

      <div class="article-total">€16.35</div>
      <div class="shipping-cost">€5.50</div>
      <div class="trustee-fee">€0.00</div>
    </div>

    <div data-seller-id="456">
      <div class="seller-name">ItalianVendor</div>
      <div class="country-badge">Italy</div>
      <div class="shipping-method">PostaPriority - €4.05</div>

      <table>
        <tbody>
          <tr data-item-id="3">
            <td class="card-name">Rhystic Study</td>
            <td class="condition">Excellent</td>
            <td><input type="number" class="qty-input" value="1" data-quantity="1"></td>
            <td class="price">€24.80</td>
          </tr>
        </tbody>
      </table>

      <div class="article-total">€24.80</div>
      <div class="shipping-cost">€4.05</div>
      <div class="trustee-fee">€0.36</div>
    </div>
  </div>
</body>
</html>
`;

/**
 * Mock Cardmarket cart page - Mobile layout
 */
export const MOCK_CART_MOBILE_EN = `
<!DOCTYPE html>
<html>
<head>
  <title>Shopping Cart</title>
</head>
<body>
  <div class="cart-overview">
    <div class="seller-card" data-seller-id="789">
      <h3 class="seller-name">FrenchDealer</h3>
      <div class="seller-info">
        <span class="country-badge">France</span>
        <span class="shipping-method">La Poste - €6.50</span>
      </div>

      <div class="cart-items">
        <div class="item-row" data-item-id="4">
          <span class="card-name">Lightning Bolt</span>
          <span class="condition">Good</span>
          <input type="number" class="qty-input" value="3">
          <span class="price">€2.50</span>
        </div>
      </div>

      <div class="cost-summary">
        <span class="article-total">€7.50</span>
        <span class="shipping-cost">€6.50</span>
      </div>
    </div>
  </div>
</body>
</html>
`;

/**
 * Mock Cardmarket cart page - German UI
 */
export const MOCK_CART_GERMAN = `
<!DOCTYPE html>
<html lang="de">
<head>
  <title>Warenkorb</title>
</head>
<body>
  <div class="warenkorb">
    <div class="verkäufer" data-seller-id="999">
      <h3 class="verkäufer-name">DeutscherVerkäufer</h3>
      <div class="land">Deutschland</div>
      <div class="versandart">Hermes - €3.50</div>

      <div class="artikel">
        <div class="artikel-zeile" data-artikel-id="5">
          <span class="kartennname">Mox Emerald</span>
          <span class="zustand">Zustand: Gut</span>
          <input type="number" value="1">
          <span class="preis">€125.00</span>
        </div>
      </div>

      <div class="artikel-summe">€125.00</div>
      <div class="versandkosten">€3.50</div>
    </div>
  </div>
</body>
</html>
`;

/**
 * Cart page with invalid data (missing some fields)
 */
export const MOCK_CART_INCOMPLETE = `
<!DOCTYPE html>
<html>
<body>
  <div data-seller-id="111">
    <div class="seller-name">PartialSeller</div>
    <!-- Missing country -->
    <!-- Missing shipping method -->

    <table>
      <tbody>
        <tr data-item-id="1">
          <td class="card-name">Test Card</td>
          <!-- Missing condition -->
          <td><input type="number" value="1"></td>
          <td class="price">€1.00</td>
        </tr>
      </tbody>
    </table>

    <!-- Missing totals -->
  </div>
</body>
</html>
`;

/**
 * Empty cart (no sellers)
 */
export const MOCK_CART_EMPTY = `
<!DOCTYPE html>
<html>
<body>
  <div class="cart-container">
    <!-- No sellers -->
  </div>
</body>
</html>
`;

/**
 * Seller with no items
 */
export const MOCK_CART_SELLER_NO_ITEMS = `
<!DOCTYPE html>
<html>
<body>
  <div data-seller-id="222">
    <div class="seller-name">EmptySeller</div>
    <div class="country-badge">Spain</div>

    <!-- No items table -->

    <div class="article-total">€0.00</div>
  </div>
</body>
</html>
`;

/**
 * Large cart with multiple sellers and items
 */
export const MOCK_CART_LARGE = `
<!DOCTYPE html>
<html>
<body>
  <div class="cart-container">
    ${Array.from({ length: 5 }, (_, sellerIdx) => `
      <div data-seller-id="${sellerIdx}">
        <div class="seller-name">Seller${sellerIdx}</div>
        <div class="country-badge">Country${sellerIdx}</div>
        <div class="shipping-method">Method - €${(sellerIdx + 1).toFixed(2)}</div>

        <table>
          <tbody>
            ${Array.from({ length: 5 }, (_, itemIdx) => `
              <tr data-item-id="${sellerIdx}-${itemIdx}">
                <td class="card-name">Card${sellerIdx}-${itemIdx}</td>
                <td class="condition">Condition</td>
                <td><input type="number" value="${itemIdx + 1}"></td>
                <td class="price">€${(itemIdx * 2.5).toFixed(2)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>

        <div class="article-total">€${(sellerIdx * 10).toFixed(2)}</div>
        <div class="shipping-cost">€${(sellerIdx + 1).toFixed(2)}</div>
      </div>
    `).join('')}
  </div>
</body>
</html>
`;
