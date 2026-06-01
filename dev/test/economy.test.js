const test = require('node:test');
const assert = require('node:assert/strict');

const { settleRound, demandAtPrice, ROUND_DEMAND_SCHEDULE } = require('../game/economy');

test('equal prices split demand and overflow transfers to other player capacity', () => {
  const result = settleRound({
    round: 4,
    priceA: 20,
    priceB: 20,
    productionA: 10,
    productionB: 100,
  });

  // round 4 => фиксированный спрос 90
  assert.equal(result.totalDemand, 90);
  assert.equal(result.players.A.soldVolume, 10);
  assert.equal(result.players.B.soldVolume, 80);
});

test('dumping penalty applies when price is below cost', () => {
  const result = settleRound({
    round: 1,
    priceA: 1,
    priceB: 10,
    productionA: 20,
    productionB: 20,
  });

  // A is cheaper, sells all 20; penalty = 0.5 * 20 = 10
  assert.equal(result.players.A.soldVolume, 20);
  assert.equal(result.players.A.penalty, 10);
  assert.equal(result.players.A.profit, -30);
});

test('market demand is fixed by round and does not depend on price', () => {
  const demandLowPrice = demandAtPrice(1, 1);
  const demandHighPrice = demandAtPrice(1, 999);

  assert.equal(demandLowPrice, ROUND_DEMAND_SCHEDULE[1]);
  assert.equal(demandHighPrice, ROUND_DEMAND_SCHEDULE[1]);
  assert.equal(demandLowPrice, demandHighPrice);
});
