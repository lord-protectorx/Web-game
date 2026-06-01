# Рынок малины (MVP)

Минимально-рабочая multiplayer-игра на Node.js с сервер-авторитетной логикой.

## Стек
- Node.js (CommonJS)
- Express
- Socket.IO
- `node:test` для unit-тестов

## Запуск
1. Установить зависимости:
```bash
npm i
```
2. Запустить сервер:
```bash
node server.js
```
3. Открыть в браузере:
- http://localhost:3000
- Вторая вкладка этого же URL = второй игрок

Оба клиента подключаются в комнату `demo`.
Первый получает роль `A`, второй `B`.

## Тесты
```bash
npm test
```

## Структура
- `server.js` — Express + Socket.IO, join/action, очередь действий per-room, таймер раундов
- `public/index.html` — UI
- `public/client.js` — сокеты, отправка действий, `render(state)`
- `game/state.js` — инициализация поля 5x7 и базового состояния
- `game/engine.js` — `startGame`, `applyAction`, `tick`, `endRound`
- `game/economy.js` — спрос/продажи/прибыль
- `storage/memory.js` — in-memory room storage
- `test/*.test.js` — unit-тесты

## Реализовано по MVP
- Сервер-авторитетное состояние (клиент не генерирует поле локально)
- BUY/UPGRADE/SET_PRICE/FINISH_ROUND
- Идемпотентность действий через `actionId`
- Конфликт покупки одной клетки решается порядком обработки на сервере
- 10 раундов по 60 секунд, досрочное завершение при `FINISH_ROUND` от обоих
- `state_snapshot`, `round_tick`, `round_ended`, `game_over`, `action_rejected`
