const test = require('node:test');
const assert = require('node:assert/strict');

const { createInitialState } = require('../game/state');
const { applyAction, startGame } = require('../game/engine');

function createRoom() {
  const room = {
    roomId: 'test-room',
    state: createInitialState('test-room'),
    processedActionIds: new Set(),
    actionQueue: [],
    processingQueue: false,
  };

  startGame(room, Date.now());
  return room;
}

function tileAt(room, x, y) {
  return room.state.tiles.find((tile) => tile.x === x && tile.y === y);
}

test('buy conflict on same tile resolves by first processed action', () => {
  const room = createRoom();

  room.state.players.A.balance = 100000;
  room.state.players.B.balance = 100000;

  const aBridge = tileAt(room, 1, 3);
  const bBridge = tileAt(room, 3, 3);
  const target = tileAt(room, 2, 3);

  aBridge.owner = 'A';
  bBridge.owner = 'B';
  target.owner = null;

  const first = applyAction(room, 'A', {
    actionId: 'a-1',
    type: 'BUY_PLOT',
    payload: { tileId: target.id },
  });

  const second = applyAction(room, 'B', {
    actionId: 'b-1',
    type: 'BUY_PLOT',
    payload: { tileId: target.id },
  });

  assert.equal(first.changed, true);
  assert.equal(second.rejected.code, 'PLOT_OCCUPIED');
  assert.equal(target.owner, 'A');
});

test('upgrade cannot push tile coefficient above 1.50', () => {
  const room = createRoom();
  const tile = tileAt(room, 0, 3);

  room.state.players.A.balance = 100000;
  tile.owner = 'A';
  tile.k = 1.45;

  const first = applyAction(room, 'A', {
    actionId: 'a-up-1',
    type: 'UPGRADE_PLOT',
    payload: { tileId: tile.id },
  });

  const second = applyAction(room, 'A', {
    actionId: 'a-up-2',
    type: 'UPGRADE_PLOT',
    payload: { tileId: tile.id },
  });

  assert.equal(first.changed, true);
  assert.equal(tile.k, 1.5);
  assert.equal(second.rejected.code, 'K_MAXED');
  assert.equal(tile.k, 1.5);
});
