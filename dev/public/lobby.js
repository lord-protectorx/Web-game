/**
 * public/lobby.js
 *
 * Клиентская логика страницы lobby.html. Этот файл не создаёт game state
 * и не запускает игру сам: он только создаёт/подключает комнату через Socket.IO,
 * сохраняет roomId/userId в browser storage и переводит пользователя на /game.
 */

(() => {
  // io() приходит из /socket.io/socket.io.js, который отдаёт сервер Socket.IO.
  const socket = io();

  // Ключи storage используются и lobby.js, и client.js, чтобы страница игры знала roomId.
  const STORAGE_USER_ID = 'raspberry_market_user_id';
  const STORAGE_ROOM_ID = 'raspberry_market_room_id';
  // sessionStorage живёт в текущей вкладке, localStorage переживает закрытие браузера.
  const session = window.sessionStorage;
  const local = window.localStorage;

  // DOM-элементы лобби. id должны совпадать с public/lobby.html.
  const createBtn = document.getElementById('createBtn');
  const joinBtn = document.getElementById('joinBtn');
  const roomInput = document.getElementById('roomInput');
  const statusEl = document.getElementById('status');
  const roomCodeEl = document.getElementById('roomCode');

  /**
   * Показывает пользователю статус операции.
   *
   * @param {string} text - Сообщение.
   * @param {'info'|'error'|'success'} kind - Визуальный тип сообщения.
   * @returns {void}
   */
  function setStatus(text, kind = 'info') {
    statusEl.textContent = text;
    statusEl.classList.remove('error', 'success');
    if (kind === 'error') statusEl.classList.add('error');
    if (kind === 'success') statusEl.classList.add('success');
  }

  /**
   * Включает/выключает кнопки на время запроса к серверу.
   *
   * @param {boolean} isBusy - true, если операция уже выполняется.
   * @returns {void}
   */
  function setBusy(isBusy) {
    createBtn.disabled = isBusy;
    joinBtn.disabled = isBusy;
  }

  /**
   * Достаёт сохранённый userId текущей вкладки.
   *
   * @returns {string|null} userId или null.
   */
  function getSavedUserId() {
    const value = session.getItem(STORAGE_USER_ID);
    return value && value.trim().length > 0 ? value.trim() : null;
  }

  /**
   * Нормализует код комнаты из input.
   *
   * @param {unknown} value - То, что ввёл пользователь.
   * @returns {string} Uppercase-код только из A-Z и 0-9.
   */
  function normalizeRoomCode(value) {
    return String(value || '')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');
  }

  /**
   * Сохраняет данные комнаты/пользователя и переводит на страницу игры.
   *
   * @param {{roomId: string, userId: string, role: 'A'|'B'}} data - Ответ сервера.
   * @returns {void}
   */
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

  // Socket.IO event: соединение с сервером успешно установлено.
  socket.on('connect', () => {
    setStatus('Сервер доступен. Можно создавать комнату или подключаться.');
  });

  // Socket.IO event: соединение потеряно, UI снова разрешает повторить действие.
  socket.on('disconnect', () => {
    setStatus('Соединение с сервером потеряно', 'error');
    setBusy(false);
  });

  // Server -> Client: room_created { roomId, userId, role }.
  socket.on('room_created', ({ roomId, userId, role }) => {
    roomCodeEl.textContent = `Код комнаты: ${roomId}`;
    setStatus('Комната создана', 'success');
    setBusy(false);
    persistAndGo({ roomId, userId, role });
  });

  // Server -> Client: room_joined { roomId, userId, role }.
  socket.on('room_joined', ({ roomId, userId, role }) => {
    roomCodeEl.textContent = `Комната: ${roomId}`;
    setStatus('Подключение выполнено', 'success');
    setBusy(false);
    persistAndGo({ roomId, userId, role });
  });

  // Server -> Client: room_error { code, message }.
  socket.on('room_error', ({ message }) => {
    setStatus(message || 'Ошибка комнаты', 'error');
    setBusy(false);
  });

  // Client -> Server: room_create { userId? }.
  createBtn.addEventListener('click', () => {
    roomCodeEl.textContent = '';
    setBusy(true);

    const payload = {};
    const userId = getSavedUserId();
    if (userId) payload.userId = userId;

    socket.emit('room_create', payload);
  });

  // Client -> Server: room_join { roomId, userId? }.
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

  // На вводе чистим код, чтобы пользователь не отправил пробелы или маленькие буквы.
  roomInput.addEventListener('input', () => {
    roomInput.value = normalizeRoomCode(roomInput.value);
  });

  // Enter в поле кода работает как кнопка "Подключиться".
  roomInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      joinBtn.click();
    }
  });
})();
