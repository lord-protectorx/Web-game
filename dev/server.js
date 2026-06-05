const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const { applyAction, getPublicState, tick, startGame } = require('./game/engine');
const { createInitialState } = require('./game/state');
const { createRoom, getRoom, getRooms } = require('./storage/memory');

const PORT = 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_CODE_LENGTH = 6;

const app = express();

app.get('/', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'lobby.html'));
});

app.get('/lobby', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'lobby.html'));
});

app.get('/game', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.use(express.static(PUBLIC_DIR, {
  index: false,
  setHeaders(res) {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
  },
}));

const server = http.createServer(app);
const io = new Server(server);

function generateUserId() {
  return `u_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeUserId(userId) {
  if (typeof userId !== 'string') return null;
  const value = userId.trim();
  return value.length > 0 ? value : null;
}

function normalizeRoomId(roomId) {
  if (typeof roomId !== 'string') return null;
  const value = roomId.trim().toUpperCase();
  return value.length > 0 ? value : null;
}

function generateRoomCode(length = ROOM_CODE_LENGTH) {
  let result = '';
  for (let i = 0; i < length; i += 1) {
    const randomIndex = Math.floor(Math.random() * ROOM_CODE_ALPHABET.length);
    result += ROOM_CODE_ALPHABET[randomIndex];
  }
  return result;
}

function createUniqueRoom() {
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const roomId = generateRoomCode();
    if (!getRoom(roomId)) {
      return createRoom(roomId);
    }
  }

  throw new Error('Failed to allocate unique room id');
}

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

function trackConnection(room, userId) {
  if (!room.connectedUsers) {
    room.connectedUsers = new Map();
  }

  const current = room.connectedUsers.get(userId) || 0;
  room.connectedUsers.set(userId, current + 1);
}

function untrackConnection(room, userId) {
  if (!room || !room.connectedUsers || !userId) return;

  const current = room.connectedUsers.get(userId) || 0;
  if (current <= 1) {
    room.connectedUsers.delete(userId);
    return;
  }

  room.connectedUsers.set(userId, current - 1);
}

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

function emitState(room) {
  io.to(room.roomId).emit('state_snapshot', { state: getPublicState(room) });
}

function emitRoundTick(room) {
  io.to(room.roomId).emit('round_tick', {
    round: room.state.round,
    secondsLeft: room.state.secondsLeft,
    roundEndsAt: room.state.roundEndsAt,
  });
}

function emitRoomError(socket, code, message) {
  socket.emit('room_error', { code, message });
}

function maybeStartRoomGame(room) {
  if (!room || room.state.status !== 'waiting') return false;

  const { A, B } = room.state.players;
  if (!A.userId || !B.userId) return false;

  startGame(room, Date.now());
  emitState(room);
  emitRoundTick(room);
  return true;
}

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

  socket.on('join', (payload = {}) => {
    joinRoomForGame(socket, payload);
  });

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

  socket.on('disconnect', () => {
    const roomId = socket.data.roomId;
    const userId = socket.data.userId;

    if (!roomId) return;

    const room = getRoom(roomId);
    untrackConnection(room, userId);
  });
});

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

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Server started on http://localhost:${PORT}`);
});
