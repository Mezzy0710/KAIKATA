// Local search over seller assignments. Pure: the cost model is injected via
// `scoreSelection` / `isBetterScore`, so this module knows nothing about app state,
// shipping tables or the DOM.
//
// `selection` is index-aligned with `groups` (one slot per group, `undefined` for
// excluded groups). Every trial built here keeps that alignment.

const IMPROVEMENT_EPSILON = 0.005;

export function improveSelection({ selection, groups, sellerCount, scoreSelection, isBetterScore, maxIterations = 500 }) {
  const context = { groups, sellerCount, scoreSelection, isBetterScore };
  let current = [...selection];
  let score = scoreSelection(current);
  let iterations = 0;

  while (iterations < maxIterations) {
    iterations += 1;
    const move = findSingleCardMove(current, score, context)
      || findSellerRemoval(current, score, context)
      || findSellerAddition(current, score, context);

    if (!move) {
      break;
    }
    current = move.selection;
    score = move.score;
  }

  return { selection: current, score, iterations };
}

function isImprovement(trialScore, score) {
  return trialScore.total - score.total < -IMPROVEMENT_EPSILON;
}

function candidateFor(group, sellerIndex) {
  return group?.candidates.find((candidate) => candidate.sellerIndex === sellerIndex);
}

function usedSellerIndexes(selection) {
  return [...new Set(selection.filter(Boolean).map((offer) => offer.sellerIndex))].sort((a, b) => a - b);
}

// Move one card to another seller's offer for that card (the original move type).
function findSingleCardMove(selection, score, { groups, sellerCount, scoreSelection }) {
  for (let fromSellerIndex = 0; fromSellerIndex < sellerCount; fromSellerIndex += 1) {
    for (let toSellerIndex = 0; toSellerIndex < sellerCount; toSellerIndex += 1) {
      if (fromSellerIndex === toSellerIndex) {
        continue;
      }
      for (let groupIndex = 0; groupIndex < selection.length; groupIndex += 1) {
        if (selection[groupIndex]?.sellerIndex !== fromSellerIndex) {
          continue;
        }
        const nextOffer = candidateFor(groups[groupIndex], toSellerIndex);
        if (!nextOffer) {
          continue;
        }
        const trial = [...selection];
        trial[groupIndex] = nextOffer;
        const trialScore = scoreSelection(trial);
        if (isImprovement(trialScore, score)) {
          return { selection: trial, score: trialScore };
        }
      }
    }
  }
  return null;
}

// Drop one used seller entirely by reassigning all of its cards.
function findSellerRemoval(selection, score, context) {
  for (const sellerIndex of usedSellerIndexes(selection)) {
    const trial = buildRemovalTrial(selection, sellerIndex, context);
    if (trial && isImprovement(trial.score, score)) {
      return trial;
    }
  }
  return null;
}

// Pull every card an unused seller offers over to it, then let the removal pass
// clean up sellers that are no longer worth their shipping.
function findSellerAddition(selection, score, context) {
  const { groups, sellerCount, scoreSelection } = context;
  const used = new Set(usedSellerIndexes(selection));

  for (let sellerIndex = 0; sellerIndex < sellerCount; sellerIndex += 1) {
    if (used.has(sellerIndex)) {
      continue;
    }
    let trial = [...selection];
    let moved = false;
    for (let groupIndex = 0; groupIndex < trial.length; groupIndex += 1) {
      if (!trial[groupIndex]) {
        continue;
      }
      const offer = candidateFor(groups[groupIndex], sellerIndex);
      if (offer) {
        trial[groupIndex] = offer;
        moved = true;
      }
    }
    if (!moved) {
      continue;
    }

    let trialScore = scoreSelection(trial);
    ({ selection: trial, score: trialScore } = runRemovalPass(trial, trialScore, sellerIndex, context));
    if (isImprovement(trialScore, score)) {
      return { selection: trial, score: trialScore };
    }
  }
  return null;
}

function runRemovalPass(selection, score, keepSellerIndex, context) {
  let current = selection;
  let currentScore = score;
  let improved = true;
  while (improved) {
    improved = false;
    for (const sellerIndex of usedSellerIndexes(current)) {
      if (sellerIndex === keepSellerIndex) {
        continue;
      }
      const trial = buildRemovalTrial(current, sellerIndex, context);
      if (trial && isImprovement(trial.score, currentScore)) {
        current = trial.selection;
        currentScore = trial.score;
        improved = true;
        break;
      }
    }
  }
  return { selection: current, score: currentScore };
}

// Reassign every card held by `sellerIndex`. Each card starts at its cheapest
// alternative among sellers already in the selection (any other seller if none),
// then each card is refined by trying every alternative against the full score.
// Returns null if some card has no other seller.
function buildRemovalTrial(selection, sellerIndex, { groups, scoreSelection, isBetterScore }) {
  const affected = [];
  for (let groupIndex = 0; groupIndex < selection.length; groupIndex += 1) {
    if (selection[groupIndex]?.sellerIndex === sellerIndex) {
      affected.push(groupIndex);
    }
  }
  if (!affected.length) {
    return null;
  }

  const otherUsed = new Set(usedSellerIndexes(selection).filter((index) => index !== sellerIndex));
  const trial = [...selection];
  const alternativesByGroup = new Map();

  for (const groupIndex of affected) {
    const alternatives = (groups[groupIndex]?.candidates || []).filter((candidate) => candidate.sellerIndex !== sellerIndex);
    if (!alternatives.length) {
      return null;
    }
    alternativesByGroup.set(groupIndex, alternatives);
    const preferred = alternatives.filter((candidate) => otherUsed.has(candidate.sellerIndex));
    trial[groupIndex] = cheapestOffer(preferred.length ? preferred : alternatives);
  }

  let trialScore = scoreSelection(trial);
  for (const groupIndex of affected) {
    for (const alternative of alternativesByGroup.get(groupIndex)) {
      if (alternative === trial[groupIndex]) {
        continue;
      }
      const candidateTrial = [...trial];
      candidateTrial[groupIndex] = alternative;
      const candidateScore = scoreSelection(candidateTrial);
      if (isBetterScore(candidateScore, trialScore)) {
        trial[groupIndex] = alternative;
        trialScore = candidateScore;
      }
    }
  }

  return { selection: trial, score: trialScore };
}

function cheapestOffer(offers) {
  return offers.reduce((best, offer) => (Number(offer.unitPrice) < Number(best.unitPrice) ? offer : best));
}
