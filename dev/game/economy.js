const DEMAND_SLOPE = 0;
const COST_PER_KG = 2;
const ROUND_DEMAND_SCHEDULE = {
  1: 60,
  2: 70,
  3: 80,
  4: 90,
  5: 100,
  6: 100,
  7: 90,
  8: 80,
  9: 70,
  10: 60,
};

function round2(value) {
  return Number(value.toFixed(2));
}

function demandIntercept(round) {
  const safeRound = Math.max(1, Math.min(10, Math.floor(Number(round) || 1)));
  return ROUND_DEMAND_SCHEDULE[safeRound];
}

function demandAtPrice(round, price) {
  // В этой модели спрос фиксирован на каждый раунд и не зависит от цены.
  void price;
  return demandIntercept(round);
}

function calcPenalty(price, soldVolume) {
  return price < COST_PER_KG ? round2(0.5 * soldVolume) : 0;
}

function calcProfit(price, soldVolume) {
  const penalty = calcPenalty(price, soldVolume);
  const profit = round2(soldVolume * (price - COST_PER_KG) - penalty);
  return { penalty, profit };
}

function settleEqualPrice(round, price, productionA, productionB) {
  const totalDemand = demandAtPrice(round, price);
  const halfDemand = totalDemand / 2;

  let soldA = Math.min(productionA, halfDemand);
  let soldB = Math.min(productionB, halfDemand);

  const overflowFromA = halfDemand - soldA;
  if (overflowFromA > 0) {
    const spareB = Math.max(0, productionB - soldB);
    soldB += Math.min(overflowFromA, spareB);
  }

  const overflowFromB = halfDemand - soldB;
  if (overflowFromB > 0) {
    const spareA = Math.max(0, productionA - soldA);
    soldA += Math.min(overflowFromB, spareA);
  }

  return {
    totalDemand,
    soldA: round2(soldA),
    soldB: round2(soldB),
  };
}

function settleRound({
  round,
  priceA,
  priceB,
  productionA,
  productionB,
}) {
  const a = demandIntercept(round);
  const b = DEMAND_SLOPE;
  const demandAtA = demandAtPrice(round, priceA);
  const demandAtB = demandAtPrice(round, priceB);

  let soldA = 0;
  let soldB = 0;
  let totalDemand = 0;

  if (priceA < priceB) {
    totalDemand = demandAtA;
    soldA = Math.min(productionA, totalDemand);
    soldB = 0;
  } else if (priceB < priceA) {
    totalDemand = demandAtB;
    soldB = Math.min(productionB, totalDemand);
    soldA = 0;
  } else {
    const equal = settleEqualPrice(round, priceA, productionA, productionB);
    totalDemand = equal.totalDemand;
    soldA = equal.soldA;
    soldB = equal.soldB;
  }

  soldA = round2(soldA);
  soldB = round2(soldB);

  const revenueA = round2(soldA * priceA);
  const revenueB = round2(soldB * priceB);
  const profitA = calcProfit(priceA, soldA);
  const profitB = calcProfit(priceB, soldB);

  return {
    round,
    a,
    b,
    totalDemand,
    demandAtA,
    demandAtB,
    players: {
      A: {
        price: priceA,
        production: round2(productionA),
        soldVolume: soldA,
        unsoldVolume: round2(Math.max(0, productionA - soldA)),
        revenue: revenueA,
        penalty: profitA.penalty,
        profit: profitA.profit,
      },
      B: {
        price: priceB,
        production: round2(productionB),
        soldVolume: soldB,
        unsoldVolume: round2(Math.max(0, productionB - soldB)),
        revenue: revenueB,
        penalty: profitB.penalty,
        profit: profitB.profit,
      },
    },
  };
}

module.exports = {
  DEMAND_SLOPE,
  COST_PER_KG,
  ROUND_DEMAND_SCHEDULE,
  demandIntercept,
  demandAtPrice,
  calcPenalty,
  calcProfit,
  settleRound,
};
