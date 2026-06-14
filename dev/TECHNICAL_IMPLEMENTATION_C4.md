# Техническое описание реализации для разработчика

Проект «Рынок малины» — сервер-авторитетная multiplayer-игра на Node.js, Express и Socket.IO. Документ описывает архитектуру в стиле C4: от общего контекста до основных модулей кода и runtime-сценариев.

## 1. C4 Level 1: System Context

На уровне контекста система выглядит как браузерная игра для двух игроков. Пользователь сначала попадает в лобби, создаёт комнату или вводит код комнаты, затем переходит на игровой экран. Все игровые решения принимает сервер.

```mermaid
C4Context
title System Context: Рынок малины

Person(playerA, "Игрок A", "Создаёт комнату, покупает и улучшает участки, задаёт цену")
Person(playerB, "Игрок B", "Подключается по коду комнаты и соревнуется с Игроком A")

System(game, "Рынок малины", "Realtime multiplayer-игра с сервер-авторитетной логикой")

Rel(playerA, game, "Открывает лобби/игру, отправляет действия", "HTTP + Socket.IO")
Rel(playerB, game, "Подключается к комнате, отправляет действия", "HTTP + Socket.IO")
```

### Внешние зависимости

В проекте нет внешней базы данных, очереди сообщений, сторонней авторизации или внешнего API. Все комнаты и состояния игр хранятся в памяти Node.js процесса.

Ключевое следствие: после перезапуска сервера все комнаты исчезают.

## 2. C4 Level 2: Container Diagram

Контейнеры здесь — это крупные исполняемые части системы: браузерный клиент, Node.js приложение и in-memory хранилище внутри процесса.

```mermaid
C4Container
title Container Diagram: Рынок малины

Person(player, "Игрок", "Пользователь в браузере")

System_Boundary(system, "Рынок малины") {
  Container(browser, "Browser Client", "HTML, CSS, JavaScript, Socket.IO Client", "Лобби, игровой экран, рендер поля, отправка действий")
  Container(server, "Node.js Application", "Node.js, Express, Socket.IO, CommonJS", "HTTP-маршруты, socket-события, игровая логика, таймеры")
  ContainerDb(memory, "In-memory Store", "JavaScript Map", "roomId -> room: state, очередь действий, processedActionIds")
}

Rel(player, browser, "Использует UI", "Browser")
Rel(browser, server, "Загружает HTML/JS/CSS", "HTTP")
Rel(browser, server, "Создаёт комнаты, входит в игру, отправляет action", "Socket.IO")
Rel(server, memory, "Создаёт/читает/обновляет комнаты", "In-process calls")
```

### Контейнер Browser Client

Файлы:
- `public/lobby.html`
- `public/lobby.js`
- `public/index.html`
- `public/client.js`
- `public/game-over-modal.js`

Ответственность:
- показать лобби;
- сохранить `roomId` и `userId` в browser storage;
- подключиться к Socket.IO;
- отправлять игровые действия;
- рендерить `state_snapshot`;
- показать финальную модалку.

Ограничение: браузер не создаёт и не изменяет авторитетный game state.

### Контейнер Node.js Application

Файлы:
- `server.js`
- `game/state.js`
- `game/engine.js`
- `game/economy.js`
- `storage/memory.js`

Ответственность:
- HTTP routes: `/`, `/lobby`, `/game`;
- раздача статических файлов;
- Socket.IO events;
- создание комнат;
- назначение ролей;
- очередь действий;
- расчёт покупок, улучшений, продаж, прибыли и победителя;
- серверный таймер раундов.

### Контейнер In-memory Store

Файл:
- `storage/memory.js`

Технически это не отдельный процесс, а `Map` внутри Node.js приложения:

```js
roomId -> {
  roomId,
  state,
  processedActionIds,
  actionQueue,
  processingQueue
}
```

Такое решение подходит для MVP и локальной демонстрации, но не подходит для production без доработок.

## 3. C4 Level 3: Component Diagram

Ниже показаны основные компоненты внутри Node.js приложения.

```mermaid
C4Component
title Component Diagram: Node.js Application

Container_Boundary(node, "Node.js Application") {
  Component(expressRoutes, "Express Routes", "server.js", "Отдаёт lobby.html и index.html")
  Component(staticMiddleware, "Static Middleware", "express.static", "Отдаёт public/*.js, public/*.html")
  Component(socketGateway, "Socket.IO Gateway", "server.js", "Обрабатывает room_create, room_join, join, action, restart_game")
  Component(roomStorage, "Room Storage", "storage/memory.js", "Хранит комнаты в Map")
  Component(stateFactory, "State Factory", "game/state.js", "Создаёт поле, игроков и начальное состояние")
  Component(engine, "Game Engine", "game/engine.js", "Валидирует действия, меняет state, управляет раундами")
  Component(economy, "Economy Module", "game/economy.js", "Считает спрос, продажи, прибыль и остаток")
  Component(timerLoop, "Timer Loop", "server.js setInterval", "Проверяет истечение времени раундов")
}

Rel(expressRoutes, staticMiddleware, "Использует")
Rel(socketGateway, roomStorage, "Создаёт и получает комнаты")
Rel(roomStorage, stateFactory, "Создаёт initial state")
Rel(socketGateway, engine, "Передаёт действия игроков")
Rel(engine, economy, "Завершает раунд через settleRound")
Rel(timerLoop, roomStorage, "Получает все комнаты")
Rel(timerLoop, engine, "Вызывает tick(room)")
Rel(socketGateway, socketGateway, "Рассылает state_snapshot/round_tick/game_over")
```

### Express Routes

Файл: `server.js`

Маршруты:
- `GET /` отдаёт `public/lobby.html`;
- `GET /lobby` отдаёт `public/lobby.html`;
- `GET /game` отдаёт `public/index.html`;
- `express.static(PUBLIC_DIR)` отдаёт `public/client.js`, `public/lobby.js`, `public/game-over-modal.js` и другие статические файлы.

### Socket.IO Gateway

Файл: `server.js`

События от клиента:

| Event | Payload | Назначение |
|---|---|---|
| `room_create` | `{ userId? }` | Создать новую комнату |
| `room_join` | `{ roomId, userId? }` | Подключиться к комнате из лобби |
| `join` | `{ roomId, userId? }` | Войти в комнату на странице игры |
| `action` | `{ actionId, type, payload }` | Отправить игровое действие |
| `restart_game` | none | Сбросить партию в текущей комнате |

События от сервера:

| Event | Payload | Назначение |
|---|---|---|
| `room_created` | `{ roomId, userId, role }` | Комната создана |
| `room_joined` | `{ roomId, userId, role }` | Игрок вошёл |
| `hello` | `{ userId, role, roomId }` | Подтверждение входа в игру |
| `state_snapshot` | `{ state }` | Полный снимок состояния |
| `round_tick` | `{ round, secondsLeft, roundEndsAt }` | Обновление таймера |
| `round_ended` | `{ roundResult }` | Итоги раунда |
| `game_over` | `{ winner, finalBalances }` | Игра завершена |
| `action_rejected` | `{ actionId, code, message }` | Игровое действие отклонено |
| `room_error` | `{ code, message }` | Ошибка комнаты |

## 4. C4 Level 4: Code / Module View

На уровне кода проект разделён на небольшие CommonJS-модули.

```mermaid
classDiagram
class server_js {
  +generateUserId()
  +normalizeUserId(userId)
  +normalizeRoomId(roomId)
  +createUniqueRoom()
  +assignRole(room, userId)
  +bindSocketToRoom(socket, room, userId, role)
  +maybeStartRoomGame(room)
  +restartRoomGame(room)
  +joinRoomForGame(socket, payload)
  +processActionQueue(room)
}

class memory_js {
  +createRoom(roomId)
  +getOrCreateRoom(roomId)
  +getRoom(roomId)
  +getRooms()
  +resetRooms()
}

class state_js {
  +tileBonusByDistance(x, y, width, height)
  +createInitialState(roomId)
}

class engine_js {
  +getBuyPrice(tileBonus)
  +getUpgradeCost(tile)
  +startGame(room, now)
  +applyAction(room, role, action)
  +endRound(room, now)
  +tick(room, now)
  +getPublicState(room)
}

class economy_js {
  +demandIntercept(round)
  +demandAtPrice(round, price)
  +allocateDemandByPrices(totalDemand, priceA, priceB, capacityA, capacityB)
  +settleRound(params)
}

server_js --> memory_js
server_js --> state_js
server_js --> engine_js
memory_js --> state_js
engine_js --> economy_js
```

### State model

Главный объект состояния находится в `room.state`.

```js
{
  roomId,
  width,
  height,
  maxRounds,
  roundSeconds,
  baseYield,
  maxPlotK,
  status,
  round,
  roundEndsAt,
  secondsLeft,
  freePlots,
  players: {
    A: {
      role,
      userId,
      balance,
      price,
      finishedRound,
      kpi: { numPlots, avgK, forecastYield }
    },
    B: { ... }
  },
  tiles: [
    { id, x, y, owner, tileBonus, k }
  ],
  marketPreview,
  lastRoundResult
}
```

### Room model

Комната оборачивает `state` и добавляет технические структуры для сервера:

```js
{
  roomId,
  state,
  processedActionIds: Set,
  actionQueue: [],
  processingQueue: false,
  connectedUsers: Map
}
```

`processedActionIds` нужен для идемпотентности. Если клиент повторно отправит тот же `actionId`, сервер не применит действие второй раз.

`actionQueue` нужна для строгого порядка обработки действий в комнате. Если два игрока покупают одну клетку, победит первое действие в очереди.

## 5. Runtime-сценарии

### 5.1 Создание комнаты

```mermaid
sequenceDiagram
  participant Player as Игрок
  participant Lobby as public/lobby.js
  participant Server as server.js
  participant Storage as storage/memory.js
  participant State as game/state.js

  Player->>Lobby: Нажимает "Создать игру"
  Lobby->>Server: room_create { userId? }
  Server->>Server: generateRoomCode()
  Server->>Storage: createRoom(roomId)
  Storage->>State: createInitialState(roomId)
  State-->>Storage: gameState status=waiting
  Storage-->>Server: room
  Server->>Server: assignRole(room, userId) => A
  Server-->>Lobby: room_created { roomId, userId, role }
  Lobby->>Lobby: save roomId/userId
  Lobby->>Player: redirect /game
```

### 5.2 Подключение второго игрока и старт игры

```mermaid
sequenceDiagram
  participant PlayerB as Игрок B
  participant Lobby as public/lobby.js
  participant Server as server.js
  participant Engine as game/engine.js
  participant Clients as Игроки в комнате

  PlayerB->>Lobby: Вводит код комнаты
  Lobby->>Server: room_join { roomId, userId? }
  Server->>Server: assignRole(room, userId) => B
  Server->>Engine: startGame(room)
  Engine-->>Server: state.status = running
  Server-->>Lobby: room_joined { roomId, userId, role }
  Server-->>Clients: state_snapshot { state }
  Server-->>Clients: round_tick { secondsLeft }
```

### 5.3 Покупка участка

```mermaid
sequenceDiagram
  participant Player as Игрок
  participant Client as public/client.js
  participant Server as server.js
  participant Engine as game/engine.js
  participant Room as room.state

  Player->>Client: Выбирает клетку и нажимает "Купить"
  Client->>Server: action { actionId, type: BUY_PLOT, payload: { tileId } }
  Server->>Server: room.actionQueue.push(action)
  Server->>Engine: applyAction(room, role, action)
  Engine->>Room: Проверяет free, adjacent, balance
  Engine->>Room: tile.owner = role, balance -= price
  Engine-->>Server: { changed: true }
  Server-->>Client: state_snapshot { state }
  Client->>Client: render(state)
```

### 5.4 Завершение раунда

```mermaid
sequenceDiagram
  participant Timer as setInterval
  participant Server as server.js
  participant Engine as game/engine.js
  participant Economy as game/economy.js
  participant Clients as Игроки

  Timer->>Server: каждые 250ms
  Server->>Engine: tick(room, Date.now())
  Engine->>Engine: now >= roundEndsAt?
  Engine->>Economy: settleRound({ prices, production })
  Economy-->>Engine: roundResult
  Engine->>Engine: balance += profit
  Engine-->>Server: { roundEnded, roundResult, gameOver? }
  Server-->>Clients: state_snapshot
  Server-->>Clients: round_ended
  alt gameOver
    Server-->>Clients: game_over
  else next round
    Server-->>Clients: round_tick
  end
```

## 6. Сервер-авторитетная логика

Клиентская сторона содержит копии некоторых формул только для подсказок UI:
- цена покупки на кнопке;
- цена улучшения на кнопке;
- доступность кнопок.

Но итоговое решение всегда принимает сервер:
- `applyAction` проверяет роль;
- проверяет статус игры;
- проверяет `actionId`;
- проверяет владельца клетки;
- проверяет соседство;
- проверяет деньги;
- меняет state;
- рассылает новый `state_snapshot`.

Это защищает проект от ситуации, когда пользователь меняет JavaScript в браузере и пытается купить недоступную клетку или получить деньги.

## 7. Обработка ошибок

Ошибки делятся на два типа.

### Ошибки комнаты

Отправляются как `room_error`:
- `ROOM_REQUIRED`;
- `ROOM_NOT_FOUND`;
- `ROOM_FULL`;
- `INVALID_ROOM_CODE`;
- `NOT_IN_ROOM`.

Их обрабатывают `public/lobby.js` и `public/client.js`.

### Ошибки игровых действий

Отправляются как `action_rejected`:
- `NO_ROLE`;
- `GAME_NOT_RUNNING`;
- `INVALID_ACTION`;
- `INVALID_ACTION_ID`;
- `PLOT_NOT_FOUND`;
- `PLOT_OCCUPIED`;
- `NOT_ADJACENT`;
- `INSUFFICIENT_FUNDS`;
- `NOT_OWNER`;
- `K_MAXED`;
- `INVALID_PRICE`;
- `UNKNOWN_ACTION`.

Функция `applyAction` не бросает исключения для обычных игровых ошибок, а возвращает объект `rejected`. Это упрощает обработку на Socket.IO уровне.

## 8. Тестирование

Тесты находятся в `test/*.test.js` и запускаются командой:

```bash
npm test
```

Покрытые правила:
- конфликт покупки одной клетки решается первым обработанным действием;
- апгрейд не превышает `1.50`;
- стартовая цена равна `100`;
- дробная цена отклоняется;
- при равных ценах продажи ограничены урожаем;
- остаток спроса переходит второму игроку;
- спрос фиксирован по раундам и не зависит от цены.

## 9. Ограничения текущей реализации

Технические ограничения MVP:
- нет постоянной базы данных;
- нет настоящей авторизации;
- `userId` можно подменить в browser storage;
- комнаты не очищаются автоматически по TTL;
- нет горизонтального масштабирования, потому что state находится в памяти одного процесса;
- нет e2e-тестов браузерного сценария;
- frontend не собран через bundler, а подключается обычными script-тегами.

Что можно улучшить:
- заменить `storage/memory.js` на PostgreSQL/Redis;
- добавить JWT/session-auth;
- добавить TTL для комнат;
- добавить Playwright e2e-тесты;
- вынести CSS в отдельные файлы;
- добавить rate limiting для Socket.IO событий.

## 10. Что важно понимать разработчику

Главный поток проекта:

1. `lobby.js` создаёт или подключает комнату.
2. `server.js` создаёт room через `storage/memory.js`.
3. `storage/memory.js` создаёт state через `game/state.js`.
4. `client.js` отправляет игровые `action`.
5. `server.js` кладёт action в очередь.
6. `game/engine.js` валидирует и применяет action.
7. `game/economy.js` считает итоги раунда.
8. `server.js` рассылает `state_snapshot`.
9. `client.js` вызывает `render(state)`.

Ключевая мысль для поддержки проекта: любое изменение игровых правил должно начинаться с серверных модулей `game/engine.js` и `game/economy.js`, а frontend должен только отображать результат.
