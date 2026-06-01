const BOARD_WIDTH = 5;
const BOARD_HEIGHT = 7;
const BASE_YIELD = 20;
const ROUND_SECONDS = 60;
const MAX_ROUNDS = 10;
const INITIAL_BALANCE = 5000;
const DEFAULT_PRICE = 100;
const MAX_PLOT_K = 1.5;

function round2(value) {
  return Number(value.toFixed(2));
}

function tileBonusByDistance(x, y, width, height) {
  const centerX = (width - 1) / 2;
  const centerY = (height - 1) / 2;
  const maxRadius = Math.hypot(centerX, centerY);
  const radius = Math.hypot(x - centerX, y - centerY) / maxRadius;

  if (radius <= 0.2) return 1.5;
  if (radius <= 0.35) return 1.3;
  if (radius <= 0.5) return 1.25;
  if (radius <= 0.65) return 1.1;
  return 1.0;
}

function createTiles(width = BOARD_WIDTH, height = BOARD_HEIGHT) {
  const tiles = [];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const tileBonus = tileBonusByDistance(x, y, width, height);
      tiles.push({
        id: `${x},${y}`,
        x,
        y,
        owner: null,
        tileBonus: round2(tileBonus),
        k: round2(tileBonus),
      });
    }
  }

  return tiles;
}

function createPlayerState(role) {
  return {
    role,
    userId: null,
    balance: INITIAL_BALANCE,
    price: DEFAULT_PRICE,
    finishedRound: false,
    kpi: {
      numPlots: 0,
      avgK: 0,
      forecastYield: 0,
    },
  };
}

function createInitialState(roomId) {
  const tiles = createTiles();
  const centerY = Math.floor(BOARD_HEIGHT / 2);

  const startA = tiles.find((tile) => tile.x === 0 && tile.y === centerY);
  const startB = tiles.find((tile) => tile.x === BOARD_WIDTH - 1 && tile.y === centerY);

  if (startA) startA.owner = 'A';
  if (startB) startB.owner = 'B';

  return {
    roomId,
    width: BOARD_WIDTH,
    height: BOARD_HEIGHT,
    maxRounds: MAX_ROUNDS,
    roundSeconds: ROUND_SECONDS,
    baseYield: BASE_YIELD,
    maxPlotK: MAX_PLOT_K,
    status: 'waiting',
    round: 1,
    roundEndsAt: null,
    secondsLeft: ROUND_SECONDS,
    freePlots: tiles.filter((tile) => tile.owner === null).length,
    players: {
      A: createPlayerState('A'),
      B: createPlayerState('B'),
    },
    tiles,
    marketPreview: {
      a: 80,
      b: 2,
      demandAtA: 0,
      demandAtB: 0,
    },
    lastRoundResult: null,
  };
}

module.exports = {
  BOARD_WIDTH,
  BOARD_HEIGHT,
  BASE_YIELD,
  ROUND_SECONDS,
  MAX_ROUNDS,
  INITIAL_BALANCE,
  DEFAULT_PRICE,
  MAX_PLOT_K,
  tileBonusByDistance,
  createInitialState,
};
