(() => {
  class GameOverModal {
    constructor({ root, onNewGame, onLobby, formatMoney, formatShort }) {
      this.root = root;
      this.onNewGame = onNewGame;
      this.onLobby = onLobby;
      this.formatMoney = formatMoney;
      this.formatShort = formatShort;
      this.isVisible = false;

      this.root.innerHTML = `
        <div class="game-over-overlay hidden" role="dialog" aria-modal="true" aria-labelledby="gameOverTitle">
          <section class="game-over-card">
            <div class="game-over-glow" aria-hidden="true"></div>
            <p class="game-over-kicker">Финальные итоги</p>
            <h2 id="gameOverTitle">Игра завершена</h2>
            <div class="game-over-winner" data-winner></div>
            <div class="game-over-capital" data-capital></div>
            <div class="game-over-note" data-note></div>

            <div class="game-over-table" data-results></div>

            <div class="game-over-actions">
              <button class="game-over-btn game-over-btn-primary" type="button" data-new-game>Новая игра</button>
              <button class="game-over-btn game-over-btn-secondary" type="button" data-lobby>Вернуться в лобби</button>
            </div>
          </section>
        </div>
      `;

      this.overlay = this.root.querySelector('.game-over-overlay');
      this.winnerEl = this.root.querySelector('[data-winner]');
      this.capitalEl = this.root.querySelector('[data-capital]');
      this.noteEl = this.root.querySelector('[data-note]');
      this.resultsEl = this.root.querySelector('[data-results]');
      this.newGameBtn = this.root.querySelector('[data-new-game]');
      this.lobbyBtn = this.root.querySelector('[data-lobby]');

      this.newGameBtn.addEventListener('click', () => {
        this.setBusy(true);
        this.onNewGame();
      });
      this.lobbyBtn.addEventListener('click', () => this.onLobby());
    }

    show({ state, finalBalances }) {
      const rows = this.createRows(state, finalBalances);
      const winnerRow = rows[0];
      const secondRow = rows[1];
      const isDraw = rows.length > 1 && rows[0].balance === rows[1].balance;

      this.winnerEl.textContent = isDraw
        ? '🏆 Ничья'
        : `🏆 Победитель: Игрок ${winnerRow.role}`;
      this.capitalEl.textContent = `Итоговый капитал: ${this.formatMoney(winnerRow.balance)} ₽`;
      this.noteEl.textContent = this.getBattleNote(winnerRow, secondRow);
      this.noteEl.classList.toggle('hidden', this.noteEl.textContent.length === 0);
      this.resultsEl.innerHTML = this.renderRows(rows);
      this.setBusy(false);

      if (!this.isVisible) {
        this.overlay.classList.remove('hidden');
        document.body.classList.add('modal-open');
        this.isVisible = true;
      }
    }

    hide() {
      this.overlay.classList.add('hidden');
      document.body.classList.remove('modal-open');
      this.setBusy(false);
      this.isVisible = false;
    }

    setBusy(isBusy) {
      this.newGameBtn.disabled = isBusy;
      this.lobbyBtn.disabled = isBusy;
      this.newGameBtn.textContent = isBusy ? 'Создаём...' : 'Новая игра';
    }

    createRows(state, finalBalances = {}) {
      const lastRound = state.lastRoundResult && state.lastRoundResult.players
        ? state.lastRoundResult.players
        : {};

      const rows = ['A', 'B'].map((role) => {
        const player = state.players[role];
        const roundPlayer = lastRound[role] || {};
        const balance = Number(finalBalances[role] ?? player.balance);
        const sold = Number(roundPlayer.soldVolume || 0);
        const revenue = Number(roundPlayer.revenue || 0);
        const avgPrice = sold > 0 ? revenue / sold : player.price;

        return {
          role,
          name: `Игрок ${role}`,
          balance,
          plots: player.kpi.numPlots,
          stock: Number(roundPlayer.unsoldVolume || 0),
          avgPrice,
        };
      }).sort((a, b) => b.balance - a.balance);

      rows.forEach((row, index) => {
        const prev = rows[index - 1];
        row.place = prev && prev.balance === row.balance ? prev.place : index + 1;
      });

      return rows;
    }

    getBattleNote(winnerRow, secondRow) {
      if (!winnerRow || !secondRow || winnerRow.balance <= 0) return '';

      const diffRatio = (winnerRow.balance - secondRow.balance) / winnerRow.balance;
      if (diffRatio < 0.05) return 'Невероятно напряжённая борьба!';
      if (diffRatio > 0.30) return 'Абсолютное доминирование победителя!';
      return '';
    }

    renderRows(rows) {
      const header = `
        <div class="game-over-table-head">
          <span>Место</span>
          <span>Игрок</span>
          <span>Баланс</span>
          <span>Участки</span>
          <span>На складе</span>
          <span>Средняя цена</span>
        </div>
      `;

      const body = rows.map((row) => `
        <div class="game-over-row">
          <span class="place" data-label="Место">${row.place} место</span>
          <span data-label="Игрок">${row.name}</span>
          <strong data-label="Баланс">${this.formatMoney(row.balance)} ₽</strong>
          <span data-label="Участки">${this.formatShort(row.plots)}</span>
          <span data-label="На складе">${this.formatShort(row.stock)} кг</span>
          <span data-label="Средняя цена">${this.formatMoney(row.avgPrice)} ₽</span>
        </div>
      `).join('');

      return header + body;
    }
  }

  window.GameOverModal = GameOverModal;
})();
