# AGENTS.md

## Project
Cardmarket Cart Optimizer

## Goal
Build a portable web app that helps users minimize total Cardmarket cart cost by parsing copied cart text, reviewing extracted data, and optimizing seller selection with shipping and trustee costs included.

## Product principles
- Correctness before polish.
- Show parsed intermediate data before optimization.
- Ambiguity must be visible and editable.
- Keep the app static and portable.
- Do not depend on proprietary runtime features from a single AI platform.

## Primary input format
Copied Cardmarket cart text from desktop or mobile.

## Secondary input formats
- Manual CSV paste
- Future: PDF upload

## Core user flow
1. User pastes copied cart text.
2. App parses seller blocks.
3. App extracts seller summary values, shipping method, tracking, and item rows.
4. App tries to infer seller country from shipping method using `shipping_data.json`.
5. App presents an editable review screen.
6. User corrects unresolved or ambiguous fields.
7. App runs optimization.
8. App shows recommended seller plan and totals.

## Parsing assumptions
- Seller blocks are usually structured around a Summary section followed by shipping method and item list.
- Desktop and mobile copies may differ in formatting.
- Seller names may be absent in some mobile copies and only appear near the cart overview footer; parser should support later matching if possible.
- Item rows may include optional comment lines between condition and price.
- Quantity may appear as `1x`, `2x`, etc.
- Prices use comma decimal style and euro symbol.

## Shipping / country inference logic
- Destination defaults to Germany.
- Use `shipping_data.json` as the primary reference for Germany-bound shipping options.
- Shipping method strings may help infer seller country.
- Inference is allowed only when confidence is high or when the method/price combination yields a unique match.
- If multiple countries match, mark as ambiguous and require user confirmation.
- Manual override must always be available.

## Optimization objective
Minimize:
- selected card prices
- plus shipping cost per used seller
- plus trustee effect where relevant

## Constraints
- One selected offer per required card copy.
- Support multi-quantity rows.
- Preserve condition information.
- Allow future filters for language, condition threshold, customs exclusion, seller exclusion.

## Required screens
### 1. Input
- paste area
- parse button
- sample input loader

### 2. Review
- extracted seller blocks
- inferred country
- shipping method
- tracking status
- item rows
- ambiguity warnings
- manual edits

### 3. Results
- sellers to keep
- sellers to drop
- per-seller breakdown
- total article value
- total shipping
- total trustee
- final total
- comparison to original cart total if available

## Suggested internal data model
### Seller block
- sellerName
- inferredCountry
- countryConfidence
- shippingMethod
- tracked
- articleValue
- shippingValue
- trusteeValue
- totalValue
- items[]

### Item
- cardName
- quantity
- condition
- comment
- unitPrice
- sellerName

## Error handling
- Never silently discard uncertain lines.
- Surface parsing warnings.
- Preserve raw block text for debugging.
- Allow a user to edit extracted values before optimization.

## Development guidance
- Start with plain text parsing for the sample carts already available in the repo.
- Build the parser before adding advanced UI.
- Use deterministic helper functions where possible.
- Keep components/files understandable so another AI tool can continue work later.

## Portability
This project must be easy to continue in Codex, Claude, or any local editor.
Avoid tool-specific magic. Prefer normal files, clear function boundaries, and explicit docs.
