# CURSOR.md — CartForge Session Start

> Read this first. Then read AGENTS.md for product spec and CLAUDE.md for full technical status.
> Update the "Current State" section at the end of every session.

---

## What this project is

CartForge is a **static, client-side web app** that optimizes a Cardmarket shopping cart for lowest
total cost. It parses pasted cart text, infers seller countries, lets the user correct ambiguities,
and runs a cost optimizer (cards + shipping + trustee fees).

No build step. No framework. No server. Deploys to GitHub Pages as-is.

---

## Tech stack


| Layer        | Choice                                     |
| ------------ | ------------------------------------------ |
| Language     | Vanilla JS, ES modules (.mjs)              |
| Styling      | Plain CSS (styles.css, ~2400 LOC)          |
| Entry point  | index.html → src/app.mjs                   |
| External API | Scryfall (reference card prices, optional) |
| Deployment   | GitHub Pages                               |
| Tests        | Vanilla Node.js, no framework              |


---

## File map (what lives where)

```
index.html                  Main UI shell
styles.css                  All styling — mobile-responsive
shipping_data.json          Cardmarket shipping rates to Germany (static)

src/
  app.mjs                   Main app logic, UI rendering (~2000 LOC — avoid growing)
  parser.mjs                Cart text parsing, country inference (~1274 LOC)
  shipping.mjs              Shipping cost + trustee calculations
  scryfall.mjs              Reference price lookups (external API, optional)
  price-verdict.mjs         Price comparison logic

extension/                  Browser extension scaffold (experimental)

tests/
  fixtures/                 Sample cart text files
  correctness-*.mjs         Functional tests
  parser-mobile-*.mjs       Mobile parsing tests
  shipping-costs.mjs        Shipping calculation tests
  price-verdict.mjs         Price logic tests
```

---

## Current state (last updated: May 13, 2026)

### Branch

`claude/review-and-plan-n5Heq`

### Open PRs


| PR  | Title                                       | Status                  | Action needed                         |
| --- | ------------------------------------------- | ----------------------- | ------------------------------------- |
| #13 | test: mobile seller names + country aliases | ✅ Clean, ready to merge | Merge immediately                     |
| #14 | Release/v1.1                                | ⚠️ Unstable CI state    | Diagnose CI failure first, then merge |


### What's working

- Core parser, optimizer, shipping logic: solid and tested
- Mobile cart parsing with seller names and country aliases
- XSS-safe rendering (escapeHtml / escapeAttribute throughout)
- 11/12 test files passing (scryfall-lookup excluded — external API timeout, expected)

### Known tech debt (prioritized)

1. `escapeHtml` defined in both `app.mjs` and `price-verdict.mjs` — extract to shared module
2. `scryfall-lookup.mjs` integration test times out in CI — needs mocking
3. `parser.mjs` is 1274 LOC — candidate for splitting into tokenization / inference / item-parsing
4. `app.mjs` is ~2000 LOC — route new logic to dedicated modules, not here

### Next actions

1. Merge PR #13
2. Diagnose PR #14 CI failure (check logs, fix, merge)
3. Extract shared `escapeHtml` utility
4. Mock scryfall integration test for CI

---

## Non-negotiable rules (enforce in every session)

- **No frameworks, no bundler.** Must run from `open index.html`.
- **Portability first.** Another AI tool or developer must be able to continue this without special setup.
- **Correctness before polish.** Parser and optimizer accuracy > visual refinement.
- **Never hide ambiguity.** Surface uncertain parse results to the user. Never silently drop data.
- **Escape everything.** `escapeHtml()` before any DOM insertion of user-controlled strings.
No exceptions. No new `innerHTML` patterns without it.

---

## How to run tests

```bash
# Core test suite (must all pass before any merge)
node tests/correctness-parser.mjs
node tests/correctness-optimizer.mjs
node tests/shipping-costs.mjs
node tests/parser-mobile-country-aliases.mjs

# Performance (large-scale, optional but useful)
node tests/performance-large-scale.mjs

# DO NOT run in CI — external API, will timeout
# node tests/scryfall-lookup.mjs
```

---

## Skill + workflow reference


| Situation                               | Invoke                                       |
| --------------------------------------- | -------------------------------------------- |
| Starting any feature or component       | `superpowers:brainstorming` first, always    |
| Implementing a written plan             | `superpowers:executing-plans`                |
| Implementation done, ready to integrate | `superpowers:finishing-a-development-branch` |
| Receiving code review feedback          | `superpowers:receiving-code-review`          |
| 2+ independent tasks, no shared state   | `superpowers:dispatching-parallel-agents`    |
| Major step complete, check vs plan      | `superpowers:code-reviewer` (subagent)       |
| Any UI change (component, layout, CSS)  | `ui-ux-pro-max` before and after             |


---

## How to update this file

At the end of each session, update:

- **Branch** — current working branch
- **Open PRs** — status and next action
- **What's working** — if something new is stable
- **Known tech debt** — add new items, remove resolved ones
- **Next actions** — reorder or update based on what changed

Keep entries short. This is a navigation aid, not a changelog.