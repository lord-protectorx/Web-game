(() => {
  const socket = io();

  const STORAGE_USER_ID = 'raspberry_market_user_id';
  const STORAGE_ROOM_ID = 'raspberry_market_room_id';
  const session = window.sessionStorage;
  const local = window.localStorage;

  const createBtn = document.getElementById('createBtn');
  const joinBtn = document.getElementById('joinBtn');
  const roomInput = document.getElementById('roomInput');
  const statusEl = document.getElementById('status');
  const roomCodeEl = document.getElementById('roomCode');

  function setStatus(text, kind = 'info') {
    statusEl.textContent = text;
    statusEl.classList.remove('error', 'success');
    if (kind === 'error') statusEl.classList.add('error');
    if (kind === 'success') statusEl.classList.add('success');
  }

  function setBusy(isBusy) {
    createBtn.disabled = isBusy;
    joinBtn.disabled = isBusy;
  }

  function getSavedUserId() {
    const value = session.getItem(STORAGE_USER_ID);
    return value && value.trim().length > 0 ? value.trim() : null;
  }

  function normalizeRoomCode(value) {
    return String(value || '')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');
  }

  function persistAndGo({ roomId, userId, role }) {
    session.setItem(STORAGE_ROOM_ID, roomId);
    session.setItem(STORAGE_USER_ID, userId);
    local.setItem(STORAGE_ROOM_ID, roomId);
    local.setItem(STORAGE_USER_ID, userId);

    setStatus(`Успешно. Роль: ${role}. Переход в игру...`, 'success');
    setTimeout(() => {
      window.location.href = '/game';
    }, 450);
  }

  socket.on('connect', () => {
    setStatus('Сервер доступен. Можно создавать комнату или подключаться.');
  });

  socket.on('disconnect', () => {
    setStatus('Соединение с сервером потеряно', 'error');
    setBusy(false);
  });

  socket.on('room_created', ({ roomId, userId, role }) => {
    roomCodeEl.textContent = `Код комнаты: ${roomId}`;
    setStatus('Комната создана', 'success');
    setBusy(false);
    persistAndGo({ roomId, userId, role });
  });

  socket.on('room_joined', ({ roomId, userId, role }) => {
    roomCodeEl.textContent = `Комната: ${roomId}`;
    setStatus('Подключение выполнено', 'success');
    setBusy(false);
    persistAndGo({ roomId, userId, role });
  });

  socket.on('room_error', ({ message }) => {
    setStatus(message || 'Ошибка комнаты', 'error');
    setBusy(false);
  });

  createBtn.addEventListener('click', () => {
    roomCodeEl.textContent = '';
    setBusy(true);

    const payload = {};
    const userId = getSavedUserId();
    if (userId) payload.userId = userId;

    socket.emit('room_create', payload);
  });

  joinBtn.addEventListener('click', () => {
    const roomId = normalizeRoomCode(roomInput.value);
    roomInput.value = roomId;

    if (!roomId) {
      setStatus('Введите код комнаты', 'error');
      return;
    }

    setBusy(true);

    const payload = { roomId };
    const userId = getSavedUserId();
    if (userId) payload.userId = userId;

    socket.emit('room_join', payload);
  });

  roomInput.addEventListener('input', () => {
    roomInput.value = normalizeRoomCode(roomInput.value);
  });

  roomInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      joinBtn.click();
    }
  });
})();
