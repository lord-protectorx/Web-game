/**
 * game/economy.js
 *
 * Чистый модуль экономики раунда. Он не знает о Socket.IO, Express или DOM.
 * На вход получает цены и объёмы производства, на выход отдаёт продажи,
 * выручку, прибыль и непроданный урожай.
 */

// В текущей версии спрос фиксирован по раундам, поэтому наклон спроса равен 0.
const DEMAND_SLOPE = 0;
// Себестоимость отключена: profit = soldVolume * price, штрафов нет.
const COST_PER_KG = 0;
// Таблица спроса по раундам: сначала спрос растёт, затем снижается.
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

/**
 * Округляет число до двух знаков после запятой.
 *
 * @param {number} value - Число для округления.
 * @returns {number} Округлённое число.
 */
function round2(value) {
  return Number(value.toFixed(2));
}

/**
 * Возвращает спрос для конкретного раунда.
 *
 * @param {number|string} round - Номер раунда.
 * @returns {number} Спрос в килограммах из ROUND_DEMAND_SCHEDULE.
 *
 * Обработка ошибок: некорректный round приводится к 1, затем ограничивается диапазоном 1..10.
 */
function demandIntercept(round) {
  const safeRound = Math.max(1, Math.min(10, Math.floor(Number(round) || 1)));
  return ROUND_DEMAND_SCHEDULE[safeRound];
}

/**
 * Возвращает спрос при цене.
 *
 * @param {number|string} round - Номер раунда.
 * @param {number} price - Цена игрока; сейчас не влияет на спрос.
 * @returns {number} Фиксированный спрос раунда.
 */
function demandAtPrice(round, price) {
  // В этой модели спрос фиксирован на каждый раунд и не зависит от цены.
  void price;
  return demandIntercept(round);
}

/**
 * Рассчитывает штраф.
 *
 * @returns {number} Сейчас всегда 0, потому что штрафы отключены.
 */
function calcPenalty() {
  return 0;
}

/**
 * Рассчитывает прибыль игрока.
 *
 * @param {number} price - Цена за кг.
 * @param {number} soldVolume - Проданный объём в кг.
 * @returns {{penalty: number, profit: number}} Штраф и прибыль.
 */
function calcProfit(price, soldVolume) {
  return {
    penalty: 0,
    profit: round2(soldVolume * price),
  };
}

/**
 * Распределяет общий спрос между игроками по ценам и доступному урожаю.
 *
 * @param {number} totalDemand - Спрос раунда в кг.
 * @param {number} priceA - Цена игрока A.
 * @param {number} priceB - Цена игрока B.
 * @param {number} capacityA - Реальный урожай A, больше него продать нельзя.
 * @param {number} capacityB - Реальный урожай B, больше него продать нельзя.
 * @returns {{soldA: number, soldB: number}} Продажи игроков.
 *
 * Бизнес-логика: меньшая цена получает спрос первой. Если урожая не хватает,
 * остаток спроса перетекает второму игроку. При равных ценах спрос делится пополам.
 */
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

/**
 * Завершает экономику одного раунда.
 *
 * @param {object} params - Параметры раунда.
 * @param {number} params.round - Номер текущего раунда.
 * @param {number} params.priceA - Цена A.
 * @param {number} params.priceB - Цена B.
 * @param {number} params.productionA - Производство A в кг.
 * @param {number} params.productionB - Производство B в кг.
 * @returns {object} roundResult: спрос, продажи, выручка, прибыль и остатки.
 *
 * Взаимодействие с данными: функция ничего не сохраняет в state сама.
 * Engine берёт результат и отдельно прибавляет profit к балансам игроков.
 */
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

// Экспортируем функции для engine.js и unit-тестов node:test.
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
