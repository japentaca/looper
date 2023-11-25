export function weightedRandom(objeto) {
  let items = Object.keys(objeto);
  let weights = Object.values(objeto);
  let totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  let random = Math.random() * totalWeight;
  let cumulativeWeight = 0;

  for (let i = 0; i < items.length; i++) {
    cumulativeWeight += weights[i];
    if (random < cumulativeWeight) {
      return items[i];
    }
  }
}
