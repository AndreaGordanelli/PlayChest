(() => {
  const modal = document.getElementById('feature-modal');
  const modalTitle = document.getElementById('feature-modal-title');
  const modalBody = document.getElementById('feature-modal-body');
  const modalClose = document.getElementById('feature-modal-close');
  let personalNotes = {};
  let notesLoaded = false;
  let notesSaveTimer = null;

  function getApp() {
    return window.gameCacheApp;
  }

  function openModal(title, html) {
    modalTitle.textContent = title;
    modalBody.innerHTML = html;
    modal.hidden = false;
  }

  function closeModal() {
    modal.hidden = true;
    modalBody.innerHTML = '';
  }

  modalClose.addEventListener('click', closeModal);
  modal.addEventListener('click', (event) => {
    if (event.target === modal) closeModal();
  });

  async function loadPersonalNotes() {
    try {
      const response = await fetch('/api/notes');
      if (response.ok) {
        personalNotes = await response.json();
      }
    } catch (error) {
      const localNotes = localStorage.getItem('gamecachePersonalNotes');
      personalNotes = localNotes ? JSON.parse(localNotes) : {};
    }
    notesLoaded = true;
  }

  async function savePersonalNotes() {
    localStorage.setItem('gamecachePersonalNotes', JSON.stringify(personalNotes));
    clearTimeout(notesSaveTimer);
    notesSaveTimer = setTimeout(async () => {
      try {
        await fetch('/api/notes', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(personalNotes),
        });
      } catch (error) {
        console.warn('Could not persist notes to server, kept in localStorage.', error);
      }
    }, 400);
  }

  function getNoteForGame(gameId) {
    return personalNotes[String(gameId)] || { note: '', customTags: [] };
  }

  function renderPersonalTags(tags) {
    if (!tags.length) return '';
    return tags.map(tag => `<span class="personal-tag-chip">${escapeHtml(tag)}</span>`).join('');
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function enhanceRenderedGames(pageGames) {
    if (!notesLoaded) return;
    pageGames.forEach(game => {
      const card = document.querySelector(`.game-card[data-game-id="${game.id}"]`);
      if (!card) return;
      const noteData = getNoteForGame(game.id);
      const section = card.querySelector('.personal-notes-section');
      const noteInput = card.querySelector('.personal-note-input');
      const tagInput = card.querySelector('.personal-tag-input');
      const tagsContainer = card.querySelector('.personal-tags');
      const saveButton = card.querySelector('.save-note-btn');

      tagsContainer.dataset.gameId = game.id;
      tagsContainer.innerHTML = renderPersonalTags(noteData.customTags || []);
      noteInput.value = noteData.note || '';
      tagInput.value = (noteData.customTags || []).join(', ');

      saveButton.onclick = (event) => {
        event.stopPropagation();
        const customTags = tagInput.value
          .split(',')
          .map(tag => tag.trim())
          .filter(Boolean);
        personalNotes[String(game.id)] = {
          note: noteInput.value.trim(),
          customTags,
        };
        tagsContainer.innerHTML = renderPersonalTags(customTags);
        savePersonalNotes();
        saveButton.textContent = 'Saved';
        setTimeout(() => { saveButton.textContent = 'Save note'; }, 1200);
      };
    });
  }

  function pickRandomGame(games) {
    if (!games.length) return null;
    return games[Math.floor(Math.random() * games.length)];
  }

  function showPickedGame(game, subtitle) {
    openModal(subtitle || 'Random pick', `
      <div class="picked-game">
        <img src="${escapeHtml(game.image)}" alt="${escapeHtml(game.name)}" class="picked-game-image">
        <h3>${escapeHtml(game.name)}</h3>
        <p>${escapeHtml(game.playing_time || 'Unknown duration')} · ${escapeHtml(getApp().getComplexityName(game.weight) || 'Unknown weight')}</p>
        <div class="modal-actions">
          <button type="button" class="primary-btn" id="open-picked-game">Open details</button>
          <button type="button" class="secondary-btn" id="pick-another-game">Pick another</button>
        </div>
      </div>
    `);

    document.getElementById('open-picked-game').onclick = () => {
      closeModal();
      getApp().openGameCard(game.id);
    };
    document.getElementById('pick-another-game').onclick = () => {
      const nextGame = pickRandomGame(getApp().getFilteredGames());
      if (nextGame) showPickedGame(nextGame, subtitle || 'Random pick');
    };
  }

  function setupRandomPicker() {
    document.getElementById('random-game-btn').addEventListener('click', () => {
      const game = pickRandomGame(getApp().getFilteredGames());
      if (!game) {
        openModal('Random pick', '<p>No games match the current filters.</p>');
        return;
      }
      showPickedGame(game, 'Random pick');
    });
  }

  function setupTonightWizard() {
    document.getElementById('tonight-btn').addEventListener('click', () => {
      openModal('What should we play tonight?', `
        <form id="tonight-form" class="tonight-form">
          <label>Players
            <input type="number" id="tonight-players" min="1" max="20" value="4">
          </label>
          <label>Max playing time
            <select id="tonight-time">
              <option value="">Any</option>
              <option value="< 30min">&lt; 30 min</option>
              <option value="30min - 1h">30 min - 1 h</option>
              <option value="1-2h" selected>1-2 h</option>
              <option value="2-3h">2-3 h</option>
              <option value="3-4h">3-4 h</option>
              <option value="> 4h">&gt; 4 h</option>
            </select>
          </label>
          <label>Complexity
            <select id="tonight-weight">
              <option value="">Any</option>
              <option value="Light">Light</option>
              <option value="Light Medium">Light Medium</option>
              <option value="Medium" selected>Medium</option>
              <option value="Medium Heavy">Medium Heavy</option>
              <option value="Heavy">Heavy</option>
            </select>
          </label>
          <button type="submit" class="primary-btn">Suggest a game</button>
        </form>
      `);

      document.getElementById('tonight-form').addEventListener('submit', (event) => {
        event.preventDefault();
        const players = Number(document.getElementById('tonight-players').value);
        const playingTime = document.getElementById('tonight-time').value;
        const weight = document.getElementById('tonight-weight').value;
        const app = getApp();
        const baseFilters = app.getFiltersFromUI();
        const tonightFilters = {
          ...baseFilters,
          selectedPlayerFilter: String(players),
          selectedPlayingTime: playingTime ? [playingTime] : [],
          selectedWeight: weight ? [weight] : [],
          page: 1,
        };
        app.applyFiltersAndSort(tonightFilters);
        app.updateURLWithFilters(tonightFilters);
        app.updateUIFromState(tonightFilters);
        app.updateResults();
        app.updateStats();

        const matches = app.getFilteredGames();
        const game = pickRandomGame(matches);
        if (!game) {
          modalBody.innerHTML = '<p>No games match tonight\'s criteria. Try relaxing the filters.</p>';
          return;
        }
        showPickedGame(game, 'Tonight\'s suggestion');
      });
    });
  }

  function buildBarChart(title, entries) {
    const maxValue = Math.max(...entries.map(entry => entry.value), 1);
    const bars = entries.map(entry => `
      <div class="stat-row">
        <span class="stat-label">${escapeHtml(entry.label)}</span>
        <div class="stat-bar-track">
          <div class="stat-bar-fill" style="width:${(entry.value / maxValue) * 100}%"></div>
        </div>
        <span class="stat-value">${entry.value}</span>
      </div>
    `).join('');
    return `<section class="stat-block"><h3>${escapeHtml(title)}</h3>${bars}</section>`;
  }

  function renderStatsDashboard() {
    const games = getApp().getAllGames();
    const neverPlayed = games.filter(game => !game.numplays).length;
    const totalPlays = games.reduce((sum, game) => sum + (game.numplays || 0), 0);
    const complexityCounts = {};
    const timeCounts = {};
    const ownerCounts = {};
    const statusCounts = {};

    games.forEach(game => {
      const complexity = getApp().getComplexityName(game.weight) || 'Unknown';
      complexityCounts[complexity] = (complexityCounts[complexity] || 0) + 1;
      timeCounts[game.playing_time || 'Unknown'] = (timeCounts[game.playing_time || 'Unknown'] || 0) + 1;
      (game.collection_owners || []).forEach(owner => {
        ownerCounts[owner] = (ownerCounts[owner] || 0) + 1;
      });
      (game.tags || []).forEach(tag => {
        statusCounts[tag] = (statusCounts[tag] || 0) + 1;
      });
    });

    const topPlayed = [...games]
      .sort((a, b) => (b.numplays || 0) - (a.numplays || 0))
      .slice(0, 5)
      .map(game => `<li>${escapeHtml(game.name)} · ${game.numplays || 0} plays</li>`)
      .join('');

    openModal('Collection statistics', `
      <div class="stats-dashboard">
        <div class="stat-cards">
          <div class="stat-card"><strong>${games.length}</strong><span>Total games</span></div>
          <div class="stat-card"><strong>${neverPlayed}</strong><span>Never played</span></div>
          <div class="stat-card"><strong>${totalPlays}</strong><span>Total plays logged</span></div>
        </div>
        ${buildBarChart('By complexity', Object.entries(complexityCounts).map(([label, value]) => ({ label, value })))}
        ${buildBarChart('By playing time', Object.entries(timeCounts).map(([label, value]) => ({ label, value })))}
        ${Object.keys(ownerCounts).length > 1 ? buildBarChart('By collection owner', Object.entries(ownerCounts).map(([label, value]) => ({ label, value }))) : ''}
        ${Object.keys(statusCounts).length ? buildBarChart('By BGG status', Object.entries(statusCounts).map(([label, value]) => ({ label, value }))) : ''}
        <section class="stat-block">
          <h3>Most played</h3>
          <ul class="stat-list">${topPlayed || '<li>No plays logged yet</li>'}</ul>
        </section>
        <div class="modal-actions">
          <button type="button" class="secondary-btn" id="show-never-played">Show never played</button>
        </div>
      </div>
    `);

    document.getElementById('show-never-played').onclick = () => {
      closeModal();
      const app = getApp();
      const filters = {
        ...app.getFiltersFromUI(),
        neverPlayedOnly: true,
        page: 1,
      };
      app.updateUIFromState(filters);
      app.applyFiltersAndSort(filters);
      app.updateURLWithFilters(filters);
      app.updateResults();
      app.updateStats();
    };
  }

  function setupStatsButton() {
    document.getElementById('stats-btn').addEventListener('click', renderStatsDashboard);
  }

  function setupViewToggle() {
    document.querySelectorAll('.view-btn').forEach(button => {
      button.addEventListener('click', () => {
        const app = getApp();
        app.applyViewMode(button.dataset.view);
        const state = app.getFiltersFromUI();
        app.updateURLWithFilters(state);
        app.updateResults();
      });
    });
  }

  function waitForAppReady() {
    if (window.gameCacheApp?.getAllGames()?.length) {
      loadPersonalNotes().then(() => {
        setupRandomPicker();
        setupTonightWizard();
        setupStatsButton();
        setupViewToggle();
      });
      return;
    }
    setTimeout(waitForAppReady, 250);
  }

  window.gameCacheFeatures = {
    enhanceRenderedGames,
  };

  waitForAppReady();
})();
