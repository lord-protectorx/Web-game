/**
 * server.js
 *
 * Точка входа в приложение. Здесь создаётся HTTP-сервер Express,
 * подключается Socket.IO, описываются маршруты страниц и все realtime-события.
 *
 * Важно для защиты: сервер является авторитетным источником состояния игры.
 * Клиент не рассчитывает владельцев участков, деньги, продажи или конец раунда,
 * а только отправляет события и отображает снапшоты, полученные от сервера.
 */

// path нужен для безопасной сборки абсолютных путей к HTML-файлам в public/.
const path = require('path');
// http нужен, потому что Socket.IO подключается поверх обычного HTTP-сервера.
const http = require('http');
// express отдаёт HTML/JS/CSS-файлы и описывает HTTP-маршруты страниц.
const express = require('express');
// Server из socket.io создаёт realtime-канал между браузером и Node.js.
const { Server } = require('socket.io');

// Игровой движок: применяет действия, считает таймеры и отдаёт безопасную копию state.
const { applyAction, getPublicState, tick, startGame } = require('./game/engine');
// Нужен для полного сброса состояния комнаты при кнопке "Новая игра".
const { createInitialState } = require('./game/state');
// In-memory storage: вместо базы данных используется Map roomId -> room.
const { createRoom, getRoom, getRooms } = require('./storage/memory');

const PORT = 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_CODE_LENGTH = 6;

const app = express();

// HTTP route: главная страница всегда открывает лобби.
app.get('/', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'lobby.html'));
});

// HTTP route: явный адрес лобби.
app.get('/lobby', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'lobby.html'));
});

// HTTP route: страница самой игры. Клиентский JS проверит roomId в storage.
app.get('/game', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// Middleware Express для статических файлов: JS, HTML, картинки, CSS внутри public/.
// Cache-Control отключает кеш, чтобы во время разработки браузер не держал старый client.js.
app.use(express.static(PUBLIC_DIR, {
  index: false,
  setHeaders(res) {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
  },
}));

const server = http.createServer(app);
const io = new Server(server);

/**
 * Генерирует временный идентификатор пользователя.
 *
 * @returns {string} userId вида "u_ab12cd34".
 *
 * Бизнес-логика: userId позволяет восстановить роль игрока при reconnect.
 * Это не JWT и не настоящая авторизация, а простой MVP-идентификатор.
 */
function generateUserId() {
  return `u_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Нормализует userId, пришедший от клиента.
 *
 * @param {unknown} userId - Значение из payload Socket.IO.
 * @returns {string|null} Строковый userId без пробелов или null.
 *
 * Обработка ошибок: не бросает исключения; некорректный тип превращает в null.
 */
function normalizeUserId(userId) {
  if (typeof userId !== 'string') return null;
  const value = userId.trim();
  return value.length > 0 ? value : null;
}

/**
 * Нормализует код комнаты.
 *
 * @param {unknown} roomId - Код комнаты из lobby/game клиента.
 * @returns {string|null} Uppercase-код комнаты или null.
 */
function normalizeRoomId(roomId) {
  if (typeof roomId !== 'string') return null;
  const value = roomId.trim().toUpperCase();
  return value.length > 0 ? value : null;
}

/**
 * Создаёт случайный короткий код комнаты.
 *
 * @param {number} length - Длина кода, по умолчанию ROOM_CODE_LENGTH.
 * @returns {string} Код из букв и цифр, например "AB7K2Q".
 */
function generateRoomCode(length = ROOM_CODE_LENGTH) {
  let result = '';
  for (let i = 0; i < length; i += 1) {
    const randomIndex = Math.floor(Math.random() * ROOM_CODE_ALPHABET.length);
    result += ROOM_CODE_ALPHABET[randomIndex];
  }
  return result;
}

/**
 * Создаёт комнату с уникальным кодом.
 *
 * @returns {object} Новая room-структура из storage/memory.js.
 * @throws {Error} Если за 1000 попыток не удалось подобрать свободный код.
 *
 * Бизнес-логика: каждая комната изолирует свою игру, игроков и очередь действий.
 */
function createUniqueRoom() {
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const roomId = generateRoomCode();
    if (!getRoom(roomId)) {
      return createRoom(roomId);
    }
  }

  throw new Error('Failed to allocate unique room id');
}

/**
 * Назначает роль A/B пользователю в комнате.
 *
 * @param {object} room - Комната с state.players.
 * @param {string} userId - Идентификатор пользователя.
 * @returns {'A'|'B'|null} Роль игрока или null, если комната заполнена.
 *
 * Бизнес-логика: первый игрок получает A, второй B. Если тот же userId
 * подключается повторно, ему возвращается прежняя роль.
 */
function assignRole(room, userId) {
  const players = room.state.players;

  if (players.A.userId === userId) return 'A';
  if (players.B.userId === userId) return 'B';

  if (!players.A.userId) {
    players.A.userId = userId;
    return 'A';
  }

  if (!players.B.userId) {
    players.B.userId = userId;
    return 'B';
  }

  return null;
}

/**
 * Увеличивает счётчик активных socket-соединений пользователя в комнате.
 *
 * @param {object} room - Комната.
 * @param {string} userId - Пользователь, открывший socket.
 * @returns {void}
 *
 * Хранилище: connectedUsers живёт в памяти процесса, это не база данных.
 */
function trackConnection(room, userId) {
  if (!room.connectedUsers) {
    room.connectedUsers = new Map();
  }

  const current = room.connectedUsers.get(userId) || 0;
  room.connectedUsers.set(userId, current + 1);
}

/**
 * Уменьшает счётчик socket-соединений пользователя.
 *
 * @param {object|null} room - Комната или null.
 * @param {string|null} userId - Идентификатор пользователя.
 * @returns {void}
 */
function untrackConnection(room, userId) {
  if (!room || !room.connectedUsers || !userId) return;

  const current = room.connectedUsers.get(userId) || 0;
  if (current <= 1) {
    room.connectedUsers.delete(userId);
    return;
  }

  room.connectedUsers.set(userId, current - 1);
}

/**
 * Привязывает socket к комнате Socket.IO и сохраняет метаданные в socket.data.
 *
 * @param {import('socket.io').Socket} socket - Подключение конкретного браузера.
 * @param {object} room - Игровая комната.
 * @param {string} userId - Идентификатор пользователя.
 * @param {'A'|'B'} role - Роль в игре.
 * @returns {void}
 *
 * Socket.IO: socket.join(roomId) позволяет отправлять события всем в комнате через io.to(roomId).
 */
function bindSocketToRoom(socket, room, userId, role) {
  const prevRoomId = socket.data.roomId;
  const prevUserId = socket.data.userId;

  if (prevRoomId && prevUserId && (prevRoomId !== room.roomId || prevUserId !== userId)) {
    const prevRoom = getRoom(prevRoomId);
    untrackConnection(prevRoom, prevUserId);
    socket.leave(prevRoomId);
  }

  if (!(prevRoomId === room.roomId && prevUserId === userId)) {
    trackConnection(room, userId);
  }

  socket.data.roomId = room.roomId;
  socket.data.userId = userId;
  socket.data.role = role;

  socket.join(room.roomId);
}

/**
 * Отправляет всем клиентам комнаты полный снимок публичного состояния.
 *
 * @param {object} room - Комната.
 * @returns {void}
 */
function emitState(room) {
  io.to(room.roomId).emit('state_snapshot', { state: getPublicState(room) });
}

/**
 * Отправляет всем клиентам комнаты состояние таймера текущего раунда.
 *
 * @param {object} room - Комната.
 * @returns {void}
 */
function emitRoundTick(room) {
  io.to(room.roomId).emit('round_tick', {
    round: room.state.round,
    secondsLeft: room.state.secondsLeft,
    roundEndsAt: room.state.roundEndsAt,
  });
}

/**
 * Унифицированно отправляет ошибку комнаты конкретному socket-клиенту.
 *
 * @param {import('socket.io').Socket} socket - Получатель ошибки.
 * @param {string} code - Машиночитаемый код ошибки.
 * @param {string} message - Текст для UI.
 * @returns {void}
 */
function emitRoomError(socket, code, message) {
  socket.emit('room_error', { code, message });
}

/**
 * Запускает игру, когда в комнате есть оба игрока.
 *
 * @param {object} room - Игровая комната.
 * @returns {boolean} true, если игра была запущена сейчас.
 *
 * Бизнес-логика: игра не стартует в одиночку. До второго игрока state.status = "waiting".
 */
function maybeStartRoomGame(room) {
  if (!room || room.state.status !== 'waiting') return false;

  const { A, B } = room.state.players;
  if (!A.userId || !B.userId) return false;

  startGame(room, Date.now());
  emitState(room);
  emitRoundTick(room);
  return true;
}

/**
 * Полностью сбрасывает партию в существующей комнате.
 *
 * @param {object} room - Комната, которую нужно перезапустить.
 * @returns {void}
 *
 * Бизнес-логика: роли A/B сохраняются, но поле, балансы, раунд, таймер,
 * очередь действий и processedActionIds сбрасываются.
 */
function restartRoomGame(room) {
  const userA = room.state.players.A.userId;
  const userB = room.state.players.B.userId;

  room.state = createInitialState(room.roomId);
  room.state.players.A.userId = userA;
  room.state.players.B.userId = userB;
  room.processedActionIds.clear();
  room.actionQueue = [];
  room.processingQueue = false;

  if (!maybeStartRoomGame(room)) {
    emitState(room);
  }
}

/**
 * Подключает пользователя к уже выбранной комнате со страницы /game.
 *
 * @param {import('socket.io').Socket} socket - Socket клиента.
 * @param {{roomId?: string, userId?: string}} payload - Данные join-события.
 * @returns {void}
 *
 * Socket event Client -> Server: join { roomId, userId? }
 * Server -> Client: hello, state_snapshot, round_tick или room_error.
 */
function joinRoomForGame(socket, payload = {}) {
  const roomId = normalizeRoomId(payload.roomId);
  if (!roomId) {
    emitRoomError(socket, 'ROOM_REQUIRED', 'Укажите код комнаты');
    return;
  }

  const room = getRoom(roomId);
  if (!room) {
    emitRoomError(socket, 'ROOM_NOT_FOUND', 'Комната не найдена');
    return;
  }

  const incomingUserId = normalizeUserId(payload.userId);
  const userId = incomingUserId || generateUserId();
  const role = assignRole(room, userId);

  if (!role) {
    emitRoomError(socket, 'ROOM_FULL', 'Комната уже заполнена (2/2)');
    return;
  }

  bindSocketToRoom(socket, room, userId, role);
  maybeStartRoomGame(room);

  socket.emit('hello', { userId, role, roomId });
  socket.emit('state_snapshot', { state: getPublicState(room) });
  if (room.state.status === 'running') {
    emitRoundTick(room);
  }
}

/**
 * Последовательно обрабатывает очередь действий одной комнаты.
 *
 * @param {object} room - Комната с actionQueue.
 * @returns {void}
 *
 * Бизнес-логика: если оба игрока пытаются купить одну клетку, победит действие,
 * которое раньше попало в очередь и было обработано сервером.
 */
function processActionQueue(room) {
  if (room.processingQueue) return;

  room.processingQueue = true;

  try {
    while (room.actionQueue.length > 0) {
      const item = room.actionQueue.shift();
      const result = applyAction(room, item.role, item.action);

      if (result.rejected) {
        io.to(item.socketId).emit('action_rejected', result.rejected);
        continue;
      }

      if (result.duplicate) {
        continue;
      }

      if (result.changed) {
        emitState(room);
      }

      if (result.roundEnded) {
        io.to(room.roomId).emit('round_ended', { roundResult: result.roundResult });

        if (result.gameOver) {
          io.to(room.roomId).emit('game_over', {
            winner: result.winner,
            finalBalances: result.finalBalances,
          });
        } else {
          emitRoundTick(room);
        }
      }
    }
  } finally {
    room.processingQueue = false;
  }
}

io.on('connection', (socket) => {
  // Client -> Server: room_create { userId? }
  // Создаёт новую комнату, назначает роль A и возвращает room_created.
  socket.on('room_create', (payload = {}) => {
    const incomingUserId = normalizeUserId(payload.userId);
    const userId = incomingUserId || generateUserId();

    let room;
    try {
      room = createUniqueRoom();
    } catch (error) {
      emitRoomError(socket, 'ROOM_CREATE_FAILED', 'Не удалось создать комнату, попробуйте снова');
      return;
    }

    const role = assignRole(room, userId);
    bindSocketToRoom(socket, room, userId, role);
    maybeStartRoomGame(room);

    socket.emit('room_created', {
      roomId: room.roomId,
      userId,
      role,
    });
  });

  // Client -> Server: room_join { roomId, userId? }
  // Подключает второго игрока по коду комнаты или возвращает room_error.
  socket.on('room_join', (payload = {}) => {
    const roomId = normalizeRoomId(payload.roomId);
    if (!roomId) {
      emitRoomError(socket, 'INVALID_ROOM_CODE', 'Введите корректный код комнаты');
      return;
    }

    const room = getRoom(roomId);
    if (!room) {
      emitRoomError(socket, 'ROOM_NOT_FOUND', 'Комната с таким кодом не найдена');
      return;
    }

    const incomingUserId = normalizeUserId(payload.userId);
    const userId = incomingUserId || generateUserId();
    const role = assignRole(room, userId);

    if (!role) {
      emitRoomError(socket, 'ROOM_FULL', 'Комната уже заполнена (2/2)');
      return;
    }

    bindSocketToRoom(socket, room, userId, role);
    maybeStartRoomGame(room);

    socket.emit('room_joined', {
      roomId,
      userId,
      role,
    });
  });

  // Client -> Server: join { roomId, userId? }
  // Используется уже на странице игры после перехода из лобби.
  socket.on('join', (payload = {}) => {
    joinRoomForGame(socket, payload);
  });

  // Client -> Server: action { actionId, type, payload }
  // Любое игровое действие кладётся в очередь комнаты, а не применяется на клиенте.
  socket.on('action', (action) => {
    const roomId = socket.data.roomId;
    if (!roomId) {
      emitRoomError(socket, 'NOT_IN_ROOM', 'Сначала подключитесь к комнате');
      return;
    }

    const room = getRoom(roomId);
    if (!room) {
      emitRoomError(socket, 'ROOM_NOT_FOUND', 'Комната не найдена');
      return;
    }

    room.actionQueue.push({
      socketId: socket.id,
      role: socket.data.role,
      action,
    });

    processActionQueue(room);
  });

  // Client -> Server: restart_game
  // Кнопка "Новая игра" в модальном окне завершения партии.
  socket.on('restart_game', () => {
    const roomId = socket.data.roomId;
    if (!roomId) {
      emitRoomError(socket, 'NOT_IN_ROOM', 'Сначала подключитесь к комнате');
      return;
    }

    const room = getRoom(roomId);
    if (!room) {
      emitRoomError(socket, 'ROOM_NOT_FOUND', 'Комната не найдена');
      return;
    }

    restartRoomGame(room);
  });

  // Срабатывает при закрытии вкладки или потере соединения.
  // Роль игрока не освобождается сразу, чтобы reconnect с тем же userId вернул его на место.
  socket.on('disconnect', () => {
    const roomId = socket.data.roomId;
    const userId = socket.data.userId;

    if (!roomId) return;

    const room = getRoom(roomId);
    untrackConnection(room, userId);
  });
});

// Серверный игровой цикл: 4 раза в секунду проверяет таймеры всех комнат.
// Если раунд закончился, engine.endRound вызывается внутри tick().
setInterval(() => {
  for (const room of getRooms()) {
    const tickResult = tick(room, Date.now());
    if (!tickResult) continue;

    if (tickResult.tick) {
      io.to(room.roomId).emit('round_tick', tickResult.tick);
      continue;
    }

    if (tickResult.roundEnded) {
      emitState(room);
      io.to(room.roomId).emit('round_ended', { roundResult: tickResult.roundResult });

      if (tickResult.gameOver) {
        io.to(room.roomId).emit('game_over', {
          winner: tickResult.winner,
          finalBalances: tickResult.finalBalances,
        });
      } else {
        emitRoundTick(room);
      }
    }
  }
}, 250);

// Запуск HTTP + Socket.IO сервера на localhost:3000.
server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Server started on http://localhost:${PORT}`);
});
