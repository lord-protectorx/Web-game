/**
 * storage/memory.js
 *
 * Простейшее in-memory хранилище комнат. Это НЕ база данных:
 * все комнаты живут только в памяти Node.js процесса и исчезают при перезапуске сервера.
 */

// createInitialState создаёт стартовый gameState для новой комнаты.
const { createInitialState } = require('../game/state');

// Map используется как roomId -> room. Это аналог словаря в Python или unordered_map в C++.
const rooms = new Map();

/**
 * Создаёт комнату и кладёт её в Map.
 *
 * @param {string} roomId - Уникальный код комнаты.
 * @returns {object} Комната с state, очередью действий и набором обработанных actionId.
 */
function createRoom(roomId) {
  const room = {
    roomId,
    state: createInitialState(roomId),
    processedActionIds: new Set(),
    actionQueue: [],
    processingQueue: false,
  };

  rooms.set(roomId, room);
  return room;
}

/**
 * Возвращает существующую комнату или создаёт новую.
 *
 * @param {string} roomId - Код комнаты.
 * @returns {object} Комната.
 */
function getOrCreateRoom(roomId) {
  if (!rooms.has(roomId)) {
    return createRoom(roomId);
  }

  return rooms.get(roomId);
}

/**
 * Ищет комнату по коду.
 *
 * @param {string} roomId - Код комнаты.
 * @returns {object|null} Комната или null, если такой комнаты нет.
 */
function getRoom(roomId) {
  return rooms.get(roomId) || null;
}

/**
 * Возвращает все комнаты.
 *
 * @returns {Array<object>} Массив комнат.
 *
 * Используется серверным таймером, чтобы пройти по всем активным играм.
 */
function getRooms() {
  return Array.from(rooms.values());
}

/**
 * Очищает все комнаты.
 *
 * @returns {void}
 *
 * Используется в тестах или ручной отладке. В боевом сервере это удалило бы все партии.
 */
function resetRooms() {
  rooms.clear();
}

// CommonJS export для server.js и тестов.
module.exports = {
  createRoom,
  getOrCreateRoom,
  getRoom,
  getRooms,
  resetRooms,
};
