const { createInitialState } = require('../game/state');
const { startGame } = require('../game/engine');

const rooms = new Map();

function createRoom(roomId) {
  const room = {
    roomId,
    state: createInitialState(roomId),
    processedActionIds: new Set(),
    actionQueue: [],
    processingQueue: false,
  };

  startGame(room, Date.now());
  rooms.set(roomId, room);
  return room;
}

function getOrCreateRoom(roomId) {
  if (!rooms.has(roomId)) {
    return createRoom(roomId);
  }

  return rooms.get(roomId);
}

function getRoom(roomId) {
  return rooms.get(roomId) || null;
}

function getRooms() {
  return Array.from(rooms.values());
}

function resetRooms() {
  rooms.clear();
}

module.exports = {
  createRoom,
  getOrCreateRoom,
  getRoom,
  getRooms,
  resetRooms,
};
