# Cardmarket Cart Optimizer

A small web app that helps optimize a Cardmarket shopping cart for lowest total cost.

## Purpose

The app takes copied Cardmarket cart text as input, extracts sellers, shipping methods, item rows, and prices, infers seller country where possible, allows manual correction, and calculates the cheapest buying plan including shipping and trustee effects.

## Primary user journey

1. Copy the full shopping cart text from Cardmarket.
2. Paste it into the app.
3. Let the app parse seller blocks and line items.
4. Review ambiguous country/method matches and correct them if needed.
5. Run optimization.
6. Review which sellers to keep, which to drop, and the final total cost.
7. Manually update the cart on Cardmarket and place the orders.

## Version 1 scope

### Input
- Primary: pasted Cardmarket cart text from desktop or mobile.
- Fallback: manual CSV paste.
- Future: PDF upload and extraction.

### Parser must extract
- Seller name
- Seller-level summary values: article value, shipping, trustee service, total
- Shipping method name
- Tracking status
- Card name
- Condition
- Quantity
- Unit price
- Optional note/comment line under card if present

### Optimization goal
Minimize total cart cost:
- sum of selected card prices
- plus shipping per used seller
- plus trustee fee where applicable

### Important constraints
- Destination country is always Germany unless changed later.
- Seller country may be inferred from shipping method, but must support manual override.
- Parsing must show a review table before optimization.
- Never hide ambiguity. Surface it clearly.

## Shipping data

The repository includes `shipping_data.json`, derived from Cardmarket shipping costs for shipments to Germany.

Use it to:
- map shipping method patterns to likely origin country
- validate shipping-price plausibility
- calculate shipping if cart assignments change

## Suggested UI flow

1. Paste cart text
2. Parse
3. Review extracted seller blocks and inferred countries
4. Correct anything ambiguous
5. Optimize
6. Show results:
   - keep sellers
   - drop sellers
   - per-seller item list
   - article subtotal
   - shipping subtotal
   - trustee subtotal
   - final total

## Tech direction

Keep the app portable and easy to migrate between AI tools.

Recommended options:
- Static HTML/CSS/JS app, or
- Small React app that can still be deployed as a static site

Avoid platform lock-in. The source code is the main asset.

## Deployment

Target deployment: GitHub Pages first.

The app should run fully client-side with no server requirement.

## Not in version 1

- Automatic Cardmarket cart editing
- User accounts
- Persistent database
- Full customs/tax engine
- Perfect country inference without fallback

## Quality bar

The app should optimize correctly before it looks polished. Parsing accuracy and transparent review matter more than visual refinement in version 1.
