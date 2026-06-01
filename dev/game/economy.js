const DEMAND_SLOPE = 0;
const COST_PER_KG = 0;
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

function calcPenalty() {
  return 0;
}

function calcProfit(price, soldVolume) {
  return {
    penalty: 0,
    profit: round2(soldVolume * price),
  };
}

function allocateDemandByPrices(totalDemand, priceA, priceB, capacityA, capacityB) {
  let soldA = 0;
  let soldB = 0;

  if (priceA < priceB) {
    soldA = Math.min(totalDemand, capacityA);
    const remaining = Math.max(0, totalDemand - soldA);
    soldB = Math.min(remaining, capacityB);
    return { soldA: round2(soldA), soldB: round2(soldB) };
  }

  if (priceB < priceA) {
    soldB = Math.min(totalDemand, capacityB);
    const remaining = Math.max(0, totalDemand - soldB);
    soldA = Math.min(remaining, capacityA);
    return { soldA: round2(soldA), soldB: round2(soldB) };
  }

  const halfDemand = totalDemand / 2;
  soldA = Math.min(halfDemand, capacityA);
  soldB = Math.min(totalDemand - halfDemand, capacityB);

  let remaining = Math.max(0, totalDemand - soldA - soldB);
  if (remaining > 0) {
    const spareA = Math.max(0, capacityA - soldA);
    const spareB = Math.max(0, capacityB - soldB);

    if (spareA >= spareB) {
      const extraA = Math.min(remaining, spareA);
      soldA += extraA;
      remaining -= extraA;
      if (remaining > 0) {
        soldB += Math.min(remaining, spareB);
      }
    } else {
      const extraB = Math.min(remaining, spareB);
      soldB += extraB;
      remaining -= extraB;
      if (remaining > 0) {
        soldA += Math.min(remaining, spareA);
      }
    }
  }

  return { soldA: round2(soldA), soldB: round2(soldB) };
}

function settleRound({
  round,
  priceA,
  priceB,
  productionA,
  productionB,
}) {
  const capacityA = round2(Math.max(0, Number(productionA) || 0));
  const capacityB = round2(Math.max(0, Number(productionB) || 0));
  const a = demandIntercept(round);
  const b = DEMAND_SLOPE;
  const demandAtA = demandAtPrice(round, priceA);
  const demandAtB = demandAtPrice(round, priceB);

  const totalDemand = demandIntercept(round);
  const allocation = allocateDemandByPrices(totalDemand, priceA, priceB, capacityA, capacityB);
  const soldA = allocation.soldA;
  const soldB = allocation.soldB;

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
        production: capacityA,
        soldVolume: soldA,
        unsoldVolume: round2(Math.max(0, capacityA - soldA)),
        revenue: revenueA,
        penalty: profitA.penalty,
        profit: profitA.profit,
      },
      B: {
        price: priceB,
        production: capacityB,
        soldVolume: soldB,
        unsoldVolume: round2(Math.max(0, capacityB - soldB)),
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
  allocateDemandByPrices,
  demandIntercept,
  demandAtPrice,
  calcPenalty,
  calcProfit,
  settleRound,
};
