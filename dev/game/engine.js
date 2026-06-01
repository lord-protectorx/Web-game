const { demandAtPrice, demandIntercept, DEMAND_SLOPE, settleRound } = require('./economy');

const BUY_PRICE_BY_BONUS = {
  '1.00': 800,
  '1.10': 1000,
  '1.25': 1200,
  '1.30': 1500,
  '1.50': 2000,
};

function round2(value) {
  return Number(value.toFixed(2));
}

function normalizeBonus(tileBonus) {
  return Number(tileBonus).toFixed(2);
}

function getBuyPrice(tileBonus) {
  const key = normalizeBonus(tileBonus);
  return BUY_PRICE_BY_BONUS[key] ?? BUY_PRICE_BY_BONUS['1.00'];
}

function getUpgradeCost(tile) {
  const diff = Math.max(0, round2(tile.k - tile.tileBonus));
  const upgradedSteps = Math.round(diff / 0.05);

  if (upgradedSteps <= 0) return 400;
  if (upgradedSteps === 1) return 700;
  return 1000;
}

function getTileById(state, tileId) {
  return state.tiles.find((tile) => tile.id === tileId) || null;
}

function hasAdjacentOwnedTile(state, role, x, y) {
  const neighbors = [
    [x - 1, y],
    [x + 1, y],
    [x, y - 1],
    [x, y + 1],
  ];

  return neighbors.some(([nx, ny]) => {
    const tile = state.tiles.find((item) => item.x === nx && item.y === ny);
    return tile && tile.owner === role;
  });
}

function calculateKpiForRole(state, role) {
  const ownedTiles = state.tiles.filter((tile) => tile.owner === role);
  const numPlots = ownedTiles.length;

  if (numPlots === 0) {
    return {
      numPlots: 0,
      avgK: 0,
      forecastYield: 0,
    };
  }

  const sumK = ownedTiles.reduce((sum, tile) => sum + tile.k, 0);
  const avgK = round2(sumK / numPlots);
  const forecastYield = round2(numPlots * state.baseYield * avgK);

  return {
    numPlots,
    avgK,
    forecastYield,
  };
}

function recomputeDerivedState(state) {
  state.players.A.kpi = calculateKpiForRole(state, 'A');
  state.players.B.kpi = calculateKpiForRole(state, 'B');
  state.freePlots = state.tiles.filter((tile) => tile.owner === null).length;

  state.marketPreview = {
    a: demandIntercept(state.round),
    b: DEMAND_SLOPE,
    demandAtA: demandAtPrice(state.round, state.players.A.price),
    demandAtB: demandAtPrice(state.round, state.players.B.price),
  };
}

function startGame(room, now = Date.now()) {
  const { state } = room;

  state.status = 'running';
  state.round = 1;
  state.roundEndsAt = now + state.roundSeconds * 1000;
  state.secondsLeft = state.roundSeconds;
  state.players.A.finishedRound = false;
  state.players.B.finishedRound = false;
  state.lastRoundResult = null;

  recomputeDerivedState(state);
}

function reject(actionId, code, message) {
  return {
    rejected: {
      actionId,
      code,
      message,
    },
  };
}

function endRound(room, now = Date.now()) {
  const { state } = room;
  if (state.status !== 'running') {
    return { roundEnded: false };
  }

  recomputeDerivedState(state);

  const roundResult = settleRound({
    round: state.round,
    priceA: state.players.A.price,
    priceB: state.players.B.price,
    productionA: state.players.A.kpi.forecastYield,
    productionB: state.players.B.kpi.forecastYield,
  });

  state.players.A.balance = round2(state.players.A.balance + roundResult.players.A.profit);
  state.players.B.balance = round2(state.players.B.balance + roundResult.players.B.profit);
  state.lastRoundResult = roundResult;

  state.players.A.finishedRound = false;
  state.players.B.finishedRound = false;

  let gameOver = false;
  let winner = 'draw';

  if (state.round >= state.maxRounds) {
    state.status = 'game_over';
    state.roundEndsAt = null;
    state.secondsLeft = 0;
    gameOver = true;

    if (state.players.A.balance > state.players.B.balance) winner = 'A';
    if (state.players.B.balance > state.players.A.balance) winner = 'B';
  } else {
    state.round += 1;
    state.roundEndsAt = now + state.roundSeconds * 1000;
    state.secondsLeft = state.roundSeconds;
  }

  recomputeDerivedState(state);

  return {
    roundEnded: true,
    roundResult,
    gameOver,
    winner,
    finalBalances: {
      A: state.players.A.balance,
      B: state.players.B.balance,
    },
  };
}

function applyAction(room, role, action) {
  const { state } = room;

  if (!role || !state.players[role]) {
    return reject(action && action.actionId, 'NO_ROLE', 'Роль не назначена для действий');
  }

  if (state.status !== 'running') {
    const message = state.status === 'waiting'
      ? 'Игра ещё не началась. Ожидание соперника'
      : 'Игра уже завершена';
    return reject(action && action.actionId, 'GAME_NOT_RUNNING', message);
  }

  if (!action || typeof action !== 'object') {
    return reject(undefined, 'INVALID_ACTION', 'Некорректный формат действия');
  }

  const { actionId, type, payload = {} } = action;

  if (typeof actionId !== 'string' || actionId.length === 0) {
    return reject(actionId, 'INVALID_ACTION_ID', 'Требуется actionId');
  }

  if (room.processedActionIds.has(actionId)) {
    return { duplicate: true };
  }

  room.processedActionIds.add(actionId);

  if (type === 'BUY_PLOT') {
    const tile = getTileById(state, payload.tileId);
    if (!tile) return reject(actionId, 'PLOT_NOT_FOUND', 'Клетка не найдена');
    if (tile.owner !== null) return reject(actionId, 'PLOT_OCCUPIED', 'Клетка уже занята');
    if (!hasAdjacentOwnedTile(state, role, tile.x, tile.y)) {
      return reject(actionId, 'NOT_ADJACENT', 'Покупать можно только соседнюю клетку');
    }

    const price = getBuyPrice(tile.tileBonus);
    if (state.players[role].balance < price) {
      return reject(actionId, 'INSUFFICIENT_FUNDS', 'Недостаточно средств для покупки');
    }

    tile.owner = role;
    state.players[role].balance = round2(state.players[role].balance - price);
    recomputeDerivedState(state);
    return { changed: true };
  }

  if (type === 'UPGRADE_PLOT') {
    const tile = getTileById(state, payload.tileId);
    if (!tile) return reject(actionId, 'PLOT_NOT_FOUND', 'Клетка не найдена');
    if (tile.owner !== role) return reject(actionId, 'NOT_OWNER', 'Можно улучшать только свою клетку');

    if (tile.k >= state.maxPlotK) {
      return reject(actionId, 'K_MAXED', 'Коэффициент уже на максимуме');
    }

    const price = getUpgradeCost(tile);
    if (state.players[role].balance < price) {
      return reject(actionId, 'INSUFFICIENT_FUNDS', 'Недостаточно средств для улучшения');
    }

    tile.k = round2(Math.min(state.maxPlotK, tile.k + 0.05));
    state.players[role].balance = round2(state.players[role].balance - price);
    recomputeDerivedState(state);
    return { changed: true };
  }

  if (type === 'SET_PRICE') {
    const price = Number(payload.price);
    if (!Number.isFinite(price) || price <= 0 || !Number.isInteger(price)) {
      return reject(actionId, 'INVALID_PRICE', 'Цена должна быть положительным целым числом');
    }

    state.players[role].price = price;
    recomputeDerivedState(state);
    return { changed: true };
  }

  if (type === 'FINISH_ROUND') {
    state.players[role].finishedRound = true;
    recomputeDerivedState(state);

    if (state.players.A.finishedRound && state.players.B.finishedRound) {
      const result = endRound(room, Date.now());
      return {
        changed: true,
        ...result,
      };
    }

    return { changed: true };
  }

  return reject(actionId, 'UNKNOWN_ACTION', `Неизвестный тип действия: ${type}`);
}

function tick(room, now = Date.now()) {
  const { state } = room;
  if (state.status !== 'running') return null;

  if (now >= state.roundEndsAt) {
    return endRound(room, now);
  }

  const secondsLeft = Math.max(0, Math.ceil((state.roundEndsAt - now) / 1000));
  if (secondsLeft !== state.secondsLeft) {
    state.secondsLeft = secondsLeft;
    return {
      tick: {
        round: state.round,
        secondsLeft: state.secondsLeft,
        roundEndsAt: state.roundEndsAt,
      },
    };
  }

  return null;
}

function getPublicState(room) {
  return JSON.parse(JSON.stringify(room.state));
}

module.exports = {
  BUY_PRICE_BY_BONUS,
  startGame,
  applyAction,
  endRound,
  tick,
  getPublicState,
  getBuyPrice,
  getUpgradeCost,
};
