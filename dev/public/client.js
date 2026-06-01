(() => {
  const socket = io();

  const STORAGE_USER_ID = 'raspberry_market_user_id';
  const STORAGE_ROOM_ID = 'raspberry_market_room_id';
  const session = window.sessionStorage;
  const local = window.localStorage;

  let myUserId = session.getItem(STORAGE_USER_ID) || null;
  let roomId = (session.getItem(STORAGE_ROOM_ID) || local.getItem(STORAGE_ROOM_ID) || '')
    .trim()
    .toUpperCase();
  let myRole = null;
  let state = null;
  let selectedTileId = null;
  let actionCounter = 0;

  if (!roomId) {
    window.location.replace('/lobby');
    return;
  }

  const els = {
    roleLabel: document.getElementById('roleLabel'),
    roomText: document.getElementById('roomText'),
    status: document.getElementById('statusText'),
    roundLabel: document.getElementById('roundLabel'),
    timeLabel: document.getElementById('timeLabel'),
    timer: document.getElementById('timerValue'),
    backLobbyBtn: document.getElementById('backLobbyBtn'),
    layoutRoot: document.getElementById('layoutRoot'),

    panelA: document.getElementById('panelA'),
    panelB: document.getElementById('panelB'),
    controlsA: document.getElementById('controlsA'),
    controlsB: document.getElementById('controlsB'),
    priceBoxA: document.getElementById('priceBoxA'),
    priceBoxB: document.getElementById('priceBoxB'),

    freeCount: document.getElementById('freeCount'),
    totalCount: document.getElementById('totalCount'),
    grid: document.getElementById('grid'),

    kpiAPlots: document.getElementById('kpiAPlots'),
    kpiAAvgK: document.getElementById('kpiAAvgK'),
    kpiABalance: document.getElementById('kpiABalance'),
    kpiAYield: document.getElementById('kpiAYield'),

    kpiBPlots: document.getElementById('kpiBPlots'),
    kpiBAvgK: document.getElementById('kpiBAvgK'),
    kpiBBalance: document.getElementById('kpiBBalance'),
    kpiBYield: document.getElementById('kpiBYield'),

    buyBtnA: document.getElementById('buyBtnA'),
    upgradeBtnA: document.getElementById('upgradeBtnA'),
    buyBtnB: document.getElementById('buyBtnB'),
    upgradeBtnB: document.getElementById('upgradeBtnB'),
    finishBtn: document.getElementById('finishBtn'),

    priceInputA: document.getElementById('priceInputA'),
    setPriceBtnA: document.getElementById('setPriceBtnA'),
    priceInputB: document.getElementById('priceInputB'),
    setPriceBtnB: document.getElementById('setPriceBtnB'),

    priceA: document.getElementById('pA'),
    priceB: document.getElementById('pB'),
    demandMetric: document.getElementById('demandMetric'),
    salesMetric: document.getElementById('salesMetric'),
  };

  function formatMoney(value) {
    return new Intl.NumberFormat('ru-RU', {
      maximumFractionDigits: 2,
    }).format(value);
  }

  function formatShort(value) {
    return new Intl.NumberFormat('ru-RU', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(value);
  }

  function roleText(role) {
    if (role === 'A') return 'Вы играете за фермера A';
    if (role === 'B') return 'Вы играете за фермера B';
    return 'Режим наблюдателя';
  }

  function setStatus(text, isError = false) {
    els.status.textContent = text;
    els.status.style.color = isError ? '#fca5a5' : '#94a3b8';
  }

  function createActionId() {
    actionCounter += 1;
    return `${myUserId || 'anon'}-${Date.now()}-${actionCounter}`;
  }

  function round2(value) {
    return Number(value.toFixed(2));
  }

  function getBuyPrice(tileBonus) {
    const key = Number(tileBonus).toFixed(2);
    if (key === '1.00') return 800;
    if (key === '1.10') return 1000;
    if (key === '1.25') return 1200;
    if (key === '1.30') return 1500;
    if (key === '1.50') return 2000;
    return 800;
  }

  function getUpgradeCost(tile) {
    const diff = Math.max(0, round2(tile.k - tile.tileBonus));
    const upgradedSteps = Math.round(diff / 0.05);

    if (upgradedSteps <= 0) return 400;
    if (upgradedSteps === 1) return 700;
    return 1000;
  }

  function getTileById(tileId) {
    if (!state || !tileId) return null;
    return state.tiles.find((tile) => tile.id === tileId) || null;
  }

  function getSelectedTile() {
    return getTileById(selectedTileId);
  }

  function hasAdjacentOwnedTile(role, x, y) {
    if (!state) return false;

    const neighbors = [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
    ];

    return neighbors.some(([nx, ny]) => state.tiles.some((tile) => (
      tile.x === nx && tile.y === ny && tile.owner === role
    )));
  }

  function formatCostLabel(value) {
    return `${formatMoney(value)} ₽`;
  }

  function setButtonCaption(button, baseText, metaText) {
    button.textContent = metaText ? `${baseText} (${metaText})` : baseText;
  }

  function updateActionCaptions(selectedTile) {
    const buyBase = 'Купить выделенный участок';
    const upgradeBase = 'Улучшить выделенный участок';

    if (!selectedTile) {
      setButtonCaption(els.buyBtnA, buyBase, 'выберите клетку');
      setButtonCaption(els.buyBtnB, buyBase, 'выберите клетку');
      setButtonCaption(els.upgradeBtnA, upgradeBase, 'выберите клетку');
      setButtonCaption(els.upgradeBtnB, upgradeBase, 'выберите клетку');
      return;
    }

    if (selectedTile.owner === null) {
      setButtonCaption(els.buyBtnA, buyBase, `цена ${formatCostLabel(getBuyPrice(selectedTile.tileBonus))}`);
      setButtonCaption(els.buyBtnB, buyBase, `цена ${formatCostLabel(getBuyPrice(selectedTile.tileBonus))}`);
    } else {
      setButtonCaption(els.buyBtnA, buyBase, 'клетка занята');
      setButtonCaption(els.buyBtnB, buyBase, 'клетка занята');
    }

    if (selectedTile.owner === 'A') {
      if (selectedTile.k >= state.maxPlotK) {
        setButtonCaption(els.upgradeBtnA, upgradeBase, 'макс. уровень');
      } else {
        setButtonCaption(els.upgradeBtnA, upgradeBase, `цена ${formatCostLabel(getUpgradeCost(selectedTile))}`);
      }
    } else {
      setButtonCaption(els.upgradeBtnA, upgradeBase, 'не ваша клетка');
    }

    if (selectedTile.owner === 'B') {
      if (selectedTile.k >= state.maxPlotK) {
        setButtonCaption(els.upgradeBtnB, upgradeBase, 'макс. уровень');
      } else {
        setButtonCaption(els.upgradeBtnB, upgradeBase, `цена ${formatCostLabel(getUpgradeCost(selectedTile))}`);
      }
    } else {
      setButtonCaption(els.upgradeBtnB, upgradeBase, 'не ваша клетка');
    }
  }

  function emitAction(type, payload = {}) {
    if (myRole !== 'A' && myRole !== 'B') {
      setStatus('Действия недоступны для наблюдателя', true);
      return;
    }

    socket.emit('action', {
      actionId: createActionId(),
      type,
      payload,
    });
  }

  function setRoleUI(role) {
    const isA = role === 'A';
    const isB = role === 'B';

    els.layoutRoot.classList.remove('role-a', 'role-b', 'role-observer');
    if (isA) els.layoutRoot.classList.add('role-a');
    else if (isB) els.layoutRoot.classList.add('role-b');
    else els.layoutRoot.classList.add('role-observer');

    els.panelA.classList.toggle('hidden', !isA);
    els.panelB.classList.toggle('hidden', !isB);

    els.controlsA.classList.toggle('hidden', !isA);
    els.priceBoxA.classList.toggle('hidden', !isA);
    els.controlsB.classList.toggle('hidden', !isB);
    els.priceBoxB.classList.toggle('hidden', !isB);
  }

  function updateTimer(secondsLeft) {
    const total = state ? state.roundSeconds : 60;
    const ratio = total > 0 ? Math.max(0, Math.min(1, secondsLeft / total)) : 0;
    const deg = Math.round(360 * ratio);

    els.timeLabel.textContent = `${String(secondsLeft).padStart(2, '0')} сек`;
    els.timer.textContent = String(secondsLeft);
    els.timer.style.background = `conic-gradient(#f59e0b ${deg}deg, rgba(255,255,255,.08) 0)`;
  }

  function setControlsEnabled() {
    const amA = myRole === 'A';
    const amB = myRole === 'B';
    const selectedTile = getSelectedTile();

    const gameRunning = Boolean(state && state.status === 'running');
    const disableA = !amA || !gameRunning;
    const disableB = !amB || !gameRunning;
    const disableFinish = (!amA && !amB) || !gameRunning;

    const canBuyA = Boolean(
      amA
      && gameRunning
      && selectedTile
      && selectedTile.owner === null
      && hasAdjacentOwnedTile('A', selectedTile.x, selectedTile.y),
    );
    const canBuyB = Boolean(
      amB
      && gameRunning
      && selectedTile
      && selectedTile.owner === null
      && hasAdjacentOwnedTile('B', selectedTile.x, selectedTile.y),
    );
    const canUpgradeA = Boolean(
      amA
      && gameRunning
      && selectedTile
      && selectedTile.owner === 'A'
      && selectedTile.k < state.maxPlotK,
    );
    const canUpgradeB = Boolean(
      amB
      && gameRunning
      && selectedTile
      && selectedTile.owner === 'B'
      && selectedTile.k < state.maxPlotK,
    );

    els.buyBtnA.disabled = !canBuyA;
    els.upgradeBtnA.disabled = !canUpgradeA;
    els.setPriceBtnA.disabled = disableA;
    els.priceInputA.disabled = disableA;

    els.buyBtnB.disabled = !canBuyB;
    els.upgradeBtnB.disabled = !canUpgradeB;
    els.setPriceBtnB.disabled = disableB;
    els.priceInputB.disabled = disableB;

    els.finishBtn.disabled = disableFinish;
    updateActionCaptions(selectedTile);
  }

  function renderGrid(tiles) {
    els.grid.innerHTML = '';

    tiles.forEach((tile) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'tile';
      el.classList.add(getBonusBandClass(tile.k));

      if (tile.owner === 'A') el.classList.add('own-a');
      if (tile.owner === 'B') el.classList.add('own-b');
      if (tile.id === selectedTileId) el.classList.add('selected');

      el.innerHTML = `<div class="coef-center"><span class="tile-value">${tile.k.toFixed(2)}</span></div>`;
      el.title = `${tile.owner || 'Свободно'} • bonus ${tile.tileBonus.toFixed(2)} • k ${tile.k.toFixed(2)}`;

      el.addEventListener('click', () => {
        selectedTileId = tile.id;
        renderGrid(tiles);
        setControlsEnabled();
      });

      els.grid.appendChild(el);
    });
  }

  function getBonusBandClass(tileBonus) {
    if (tileBonus <= 1.0) return 'coef-blue';
    if (tileBonus <= 1.1) return 'coef-green';
    if (tileBonus <= 1.25) return 'coef-yellow';
    if (tileBonus <= 1.3) return 'coef-orange';
    return 'coef-red';
  }

  function renderPlayerKpi(role, player) {
    if (role === 'A') {
      els.kpiAPlots.textContent = formatShort(player.kpi.numPlots);
      els.kpiAAvgK.textContent = formatShort(player.kpi.avgK);
      els.kpiABalance.textContent = formatMoney(player.balance);
      els.kpiAYield.textContent = `${formatShort(player.kpi.forecastYield)} кг`;
      els.priceInputA.value = player.price;
      return;
    }

    els.kpiBPlots.textContent = formatShort(player.kpi.numPlots);
    els.kpiBAvgK.textContent = formatShort(player.kpi.avgK);
    els.kpiBBalance.textContent = formatMoney(player.balance);
    els.kpiBYield.textContent = `${formatShort(player.kpi.forecastYield)} кг`;
    els.priceInputB.value = player.price;
  }

  function render(nextState) {
    const prevStatus = state ? state.status : null;
    state = nextState;

    els.roundLabel.textContent = `Раунд ${state.round}/${state.maxRounds}`;
    if (state.status === 'game_over') {
      els.roundLabel.textContent = `Игра завершена (${state.maxRounds}/${state.maxRounds})`;
    }

    els.freeCount.textContent = String(state.freePlots);
    els.totalCount.textContent = String(state.tiles.length);

    renderPlayerKpi('A', state.players.A);
    renderPlayerKpi('B', state.players.B);

    els.priceA.textContent = formatShort(state.players.A.price);
    els.priceB.textContent = formatShort(state.players.B.price);
    els.demandMetric.textContent = `${formatShort(state.marketPreview.demandAtA)} кг`;

    if (state.lastRoundResult) {
      const soldA = formatShort(state.lastRoundResult.players.A.soldVolume);
      const soldB = formatShort(state.lastRoundResult.players.B.soldVolume);
      els.salesMetric.textContent = `${soldA} / ${soldB}`;
    } else {
      els.salesMetric.textContent = '— / —';
    }

    if (!state.tiles.some((tile) => tile.id === selectedTileId)) {
      selectedTileId = null;
    }

    updateTimer(state.secondsLeft);
    setControlsEnabled();

    if (state.status === 'waiting') {
      setStatus('Ожидание соперника. Игра начнётся автоматически после его подключения.');
    } else if (prevStatus === 'waiting' && state.status === 'running') {
      setStatus('Соперник подключился. Раунд начался.');
    }

    renderGrid(state.tiles);
  }

  function readPrice(input) {
    const value = Number(input.value);
    return Number.isFinite(value) ? value : NaN;
  }

  function requireSelectedTile() {
    if (!selectedTileId) {
      setStatus('Сначала выберите клетку на карте', true);
      return null;
    }

    return selectedTileId;
  }

  function leaveToLobby() {
    session.removeItem(STORAGE_ROOM_ID);
    local.removeItem(STORAGE_ROOM_ID);
    window.location.href = '/lobby';
  }

  els.buyBtnA.addEventListener('click', () => {
    const tileId = requireSelectedTile();
    if (!tileId) return;
    emitAction('BUY_PLOT', { tileId });
  });

  els.buyBtnB.addEventListener('click', () => {
    const tileId = requireSelectedTile();
    if (!tileId) return;
    emitAction('BUY_PLOT', { tileId });
  });

  els.upgradeBtnA.addEventListener('click', () => {
    const tileId = requireSelectedTile();
    if (!tileId) return;
    emitAction('UPGRADE_PLOT', { tileId });
  });

  els.upgradeBtnB.addEventListener('click', () => {
    const tileId = requireSelectedTile();
    if (!tileId) return;
    emitAction('UPGRADE_PLOT', { tileId });
  });

  els.setPriceBtnA.addEventListener('click', () => {
    const price = readPrice(els.priceInputA);
    if (!Number.isFinite(price) || price <= 0 || !Number.isInteger(price)) {
      setStatus('Введите целую цену > 0', true);
      return;
    }

    emitAction('SET_PRICE', { price });
  });

  els.setPriceBtnB.addEventListener('click', () => {
    const price = readPrice(els.priceInputB);
    if (!Number.isFinite(price) || price <= 0 || !Number.isInteger(price)) {
      setStatus('Введите целую цену > 0', true);
      return;
    }

    emitAction('SET_PRICE', { price });
  });

  els.finishBtn.addEventListener('click', () => {
    emitAction('FINISH_ROUND', {});
  });

  els.backLobbyBtn.addEventListener('click', leaveToLobby);

  socket.on('connect', () => {
    const payload = { roomId };
    if (myUserId) payload.userId = myUserId;
    socket.emit('join', payload);
  });

  socket.on('hello', ({ userId, role, roomId: connectedRoomId }) => {
    myUserId = userId;
    myRole = role;
    roomId = connectedRoomId;

    session.setItem(STORAGE_USER_ID, userId);
    session.setItem(STORAGE_ROOM_ID, connectedRoomId);
    local.setItem(STORAGE_USER_ID, userId);
    local.setItem(STORAGE_ROOM_ID, connectedRoomId);

    els.roleLabel.textContent = roleText(role);
    els.roomText.textContent = `Комната: ${connectedRoomId}`;

    setRoleUI(role);
    setStatus('Подключение установлено');
    setControlsEnabled();
  });

  socket.on('state_snapshot', ({ state: nextState }) => {
    render(nextState);
  });

  socket.on('round_tick', ({ secondsLeft }) => {
    updateTimer(secondsLeft);
  });

  socket.on('round_ended', ({ roundResult }) => {
    const pA = roundResult.players.A.profit;
    const pB = roundResult.players.B.profit;
    setStatus(`Раунд ${roundResult.round} завершён. Профит A/B: ${formatShort(pA)} / ${formatShort(pB)}`);
  });

  socket.on('game_over', ({ winner, finalBalances }) => {
    const winnerText = winner === 'draw' ? 'Ничья' : `Победитель: ${winner}`;
    setStatus(`${winnerText}. Балансы A/B: ${formatShort(finalBalances.A)} / ${formatShort(finalBalances.B)}`);
    setControlsEnabled();
  });

  socket.on('action_rejected', ({ message, code }) => {
    setStatus(`Действие отклонено (${code}): ${message}`, true);
  });

  socket.on('room_error', ({ code, message }) => {
    setStatus(`Ошибка комнаты (${code}): ${message}`, true);

    if (code === 'ROOM_NOT_FOUND' || code === 'ROOM_REQUIRED' || code === 'ROOM_FULL') {
      setTimeout(() => {
        leaveToLobby();
      }, 800);
    }
  });

  socket.on('disconnect', () => {
    setStatus('Соединение потеряно, ожидаю переподключение', true);
  });
})();
