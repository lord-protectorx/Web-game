/**
 * test/economy.test.js
 *
 * Unit-тесты экономики. Они проверяют, как спрос распределяется между игроками
 * и как считается прибыль при ограниченном реальном урожае.
 */

// node:test - встроенный тестовый раннер Node.js.
const test = require('node:test');
// assert/strict используется для строгих проверок ожидаемых чисел.
const assert = require('node:assert/strict');

// Тестируем публичные функции economy.js напрямую, без запуска сервера.
const { settleRound, demandAtPrice, ROUND_DEMAND_SCHEDULE } = require('../game/economy');

// При равной цене спрос делится, но продажи не могут быть больше production.
test('equal prices split demand but sales are capped by each player production', () => {
  const result = settleRound({
    round: 4,
    priceA: 20,
    priceB: 20,
    productionA: 10,
    productionB: 100,
  });

  // round 4 => фиксированный спрос 90, при равной цене делим поровну (45/45),
  // но A может продать только 10 кг, остаток перетекает к B.
  assert.equal(result.totalDemand, 90);
  assert.equal(result.players.A.soldVolume, 10);
  assert.equal(result.players.B.soldVolume, 80);
});

// Если дешёвый игрок не может закрыть весь спрос урожаем, остаток получает второй игрок.
test('if lowest price player has low production, remaining demand goes to second player', () => {
  const result = settleRound({
    round: 1,
    priceA: 100,
    priceB: 150,
    productionA: 22,
    productionB: 100,
  });

  // Спрос 60: A дешевле и продает максимум урожая (22),
  // остаток 38 уходит B.
  assert.equal(result.players.A.soldVolume, 22);
  assert.equal(result.players.B.soldVolume, 38);
  assert.equal(result.players.A.penalty, 0);
  assert.equal(result.players.A.profit, 2200);
  assert.equal(result.players.B.profit, 5700);
});

// Текущая модель спроса зависит только от номера раунда, а не от цены.
test('market demand is fixed by round and does not depend on price', () => {
  const demandLowPrice = demandAtPrice(1, 1);
  const demandHighPrice = demandAtPrice(1, 999);

  assert.equal(demandLowPrice, ROUND_DEMAND_SCHEDULE[1]);
  assert.equal(demandHighPrice, ROUND_DEMAND_SCHEDULE[1]);
  assert.equal(demandLowPrice, demandHighPrice);
});
