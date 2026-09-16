(() => {
  const modal = document.getElementById('feature-modal');
  const modalPanel = document.getElementById('featureModalPanel');
  const modalTitle = document.getElementById('feature-modal-title');
  const modalBody = document.getElementById('feature-modal-body');
  const modalClose = document.getElementById('feature-modal-close');
  let personalNotes = {};
  let notesLoaded = false;
  let notesSaveTimer = null;
  let compareModeActive = false;
  const compareGameIds = [null, null];

  function getApp() {
    return window.gameCacheApp;
  }

  function openModal(title, html, options = {}) {
    modalTitle.textContent = title;
    modalBody.innerHTML = html;
    modalPanel.classList.toggle('is-wide', Boolean(options.wide));
    modal.hidden = false;
  }

  function closeModal() {
    modal.hidden = true;
    modalBody.innerHTML = '';
    modalPanel.classList.remove('is-wide');
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
    if (notesLoaded) {
      pageGames.forEach(game => {
        const card = document.querySelector(`.game-card[data-game-id="${game.id}"]`);
        if (!card) return;
        const noteData = getNoteForGame(game.id);
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
    refreshCompareSelection();
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

  function isCompareSelected(gameId) {
    return compareGameIds.includes(String(gameId));
  }

  function getGameById(gameId) {
    if (!gameId) return null;
    return getApp().getAllGames().find(game => String(game.id) === String(gameId)) || null;
  }

  function formatPlayers(players) {
    if (typeof getApp().formatPlayerCount === 'function') {
      return getApp().formatPlayerCount(players || []) || 'Unknown';
    }
    if (!players || !players.length) return 'Unknown';
    return players.map(([count, type]) => {
      const suffix = type === 'best' ? ' (best)' : type === 'recommended' ? ' (rec.)' : '';
      return count + suffix;
    }).join(', ') || 'Unknown';
  }

  function updateCompareBanner() {
    const text = document.getElementById('compareBannerText');
    if (!text) return;
    const count = compareGameIds.filter(Boolean).length;
    text.textContent = count === 1
      ? 'Select a second game to compare'
      : 'Click two games to compare';
  }

  function setCompareMode(active) {
    compareModeActive = active;
    document.documentElement.classList.toggle('is-compare-mode', active);
    const banner = document.getElementById('compareBanner');
    if (banner) banner.hidden = !active;
    const toolbarBtn = document.getElementById('compareBtn');
    if (toolbarBtn) toolbarBtn.classList.toggle('is-active', active || compareGameIds.some(Boolean));
    if (active) updateCompareBanner();
  }

  function exitCompareMode() {
    compareGameIds[0] = null;
    compareGameIds[1] = null;
    setCompareMode(false);
    refreshCompareSelection();
  }

  function refreshCompareSelection() {
    document.querySelectorAll('.game-card').forEach(card => {
      card.classList.toggle('is-compare-selected', isCompareSelected(card.dataset.gameId));
    });
    const toolbarBtn = document.getElementById('compareBtn');
    if (toolbarBtn) {
      toolbarBtn.classList.toggle('is-active', compareModeActive || compareGameIds.some(Boolean));
    }
  }

  function updateComparePicker(slot) {
    const picker = modalBody.querySelector(`.comparePicker[data-slot="${slot}"]`);
    if (!picker) return;
    const selected = getGameById(compareGameIds[slot]);
    picker.querySelector('.comparePicked').innerHTML = selected
      ? renderPickedGame(selected)
      : '<p class="compareEmpty">No game selected</p>';
  }

  function setCompareGame(slot, game) {
    if (game && compareGameIds[1 - slot] === String(game.id)) {
      compareGameIds[1 - slot] = null;
    }
    compareGameIds[slot] = game ? String(game.id) : null;
    refreshCompareSelection();
    updateComparePicker(0);
    updateComparePicker(1);
    renderCompareResult();
  }

  function pickCompareFromGrid(game) {
    const gameId = String(game.id);
    const existingSlot = compareGameIds.indexOf(gameId);
    if (existingSlot >= 0) {
      setCompareGame(existingSlot, null);
      updateCompareBanner();
      return;
    }
    const emptySlot = compareGameIds.findIndex(id => !id);
    setCompareGame(emptySlot === -1 ? 1 : emptySlot, game);
    if (compareGameIds[0] && compareGameIds[1]) {
      setCompareMode(false);
      openCompareModal();
      return;
    }
    updateCompareBanner();
  }

  function searchGames(query) {
    const needle = query.trim().toLowerCase();
    const matches = [];
    const seen = new Set();
    const consider = (games) => {
      games.forEach(game => {
        if (seen.has(game.id)) return;
        if (needle && !game.name.toLowerCase().includes(needle)) return;
        seen.add(game.id);
        matches.push(game);
      });
    };
    consider(getApp().getFilteredGames());
    consider(getApp().getAllGames());
    return matches.slice(0, 12);
  }

  function renderPickedGame(game) {
    return `
      <div class="comparePickedCard">
        <img src="${escapeHtml(game.image)}" alt="${escapeHtml(game.name)}">
        <strong>${escapeHtml(game.name)}</strong>
      </div>
    `;
  }

  function renderMechanicChips(mechanics, extraClass) {
    return mechanics.map(mechanic => (
      `<span class="compareChip ${extraClass}">${escapeHtml(mechanic)}</span>`
    )).join('');
  }

  function renderMechanicColumn(shared, unique) {
    if (!shared.length && !unique.length) return '<span class="compareMuted">None</span>';
    return `${renderMechanicChips(shared, 'is-shared')}${renderMechanicChips(unique, 'is-unique')}`;
  }

  function renderCompareResult() {
    const result = document.getElementById('compareResult');
    if (!result) return;
    const left = getGameById(compareGameIds[0]);
    const right = getGameById(compareGameIds[1]);
    if (!left || !right) {
      result.innerHTML = '<p class="compareHint">Pick two games to compare players, playing time, complexity, and mechanics.</p>';
      return;
    }

    const app = getApp();
    const leftPlayers = formatPlayers(left.players);
    const rightPlayers = formatPlayers(right.players);
    const leftTime = left.playing_time || 'Unknown';
    const rightTime = right.playing_time || 'Unknown';
    const leftWeightName = app.getComplexityName(left.weight) || 'Unknown';
    const rightWeightName = app.getComplexityName(right.weight) || 'Unknown';
    const leftWeight = Number.isFinite(left.weight) ? `${leftWeightName} (${left.weight.toFixed(1)})` : leftWeightName;
    const rightWeight = Number.isFinite(right.weight) ? `${rightWeightName} (${right.weight.toFixed(1)})` : rightWeightName;
    const leftMechanics = left.mechanics || [];
    const rightMechanics = right.mechanics || [];
    const rightSet = new Set(rightMechanics);
    const leftSet = new Set(leftMechanics);
    const shared = leftMechanics.filter(mechanic => rightSet.has(mechanic)).sort();
    const onlyLeft = leftMechanics.filter(mechanic => !rightSet.has(mechanic)).sort();
    const onlyRight = rightMechanics.filter(mechanic => !leftSet.has(mechanic)).sort();

    const row = (label, leftValue, rightValue, isHtml = false) => {
      const differs = !isHtml && leftValue !== rightValue;
      return `
        <div class="compareRow${differs ? ' is-diff' : ''}">
          <div class="compareLabel">${escapeHtml(label)}</div>
          <div class="compareValue">${isHtml ? leftValue : escapeHtml(leftValue)}</div>
          <div class="compareValue">${isHtml ? rightValue : escapeHtml(rightValue)}</div>
        </div>
      `;
    };

    result.innerHTML = `
      <div class="compareTable">
        <div class="compareRow compareHead">
          <div></div>
          <div>${escapeHtml(left.name)}</div>
          <div>${escapeHtml(right.name)}</div>
        </div>
        ${row('Players', leftPlayers, rightPlayers)}
        ${row('Playing time', leftTime, rightTime)}
        ${row('Complexity', leftWeight, rightWeight)}
        ${row(
          'Mechanics',
          renderMechanicColumn(shared, onlyLeft),
          renderMechanicColumn(shared, onlyRight),
          true
        )}
      </div>
      <p class="compareLegend">
        <span class="compareChip is-shared">Shared</span>
        <span class="compareChip is-unique">Only on this game</span>
      </p>
    `;
  }

  function hideSuggestions(picker) {
    const list = picker.querySelector('.compareSuggestions');
    list.hidden = true;
    list.innerHTML = '';
  }

  function showSuggestions(picker, games) {
    const list = picker.querySelector('.compareSuggestions');
    if (!games.length) {
      hideSuggestions(picker);
      return;
    }
    list.innerHTML = games.map(game => (
      `<li><button type="button" class="compareSuggestion" data-game-id="${escapeHtml(String(game.id))}">${escapeHtml(game.name)}</button></li>`
    )).join('');
    list.hidden = false;
  }

  function selectSuggestion(picker, slot, gameId) {
    const game = getGameById(gameId);
    if (!game) return;
    const input = picker.querySelector('.compareSearchInput');
    input.value = '';
    hideSuggestions(picker);
    setCompareGame(slot, game);
  }

  function bindCompareModal() {
    modalBody.querySelectorAll('.comparePicker').forEach(picker => {
      const slot = Number(picker.dataset.slot);
      const input = picker.querySelector('.compareSearchInput');
      const list = picker.querySelector('.compareSuggestions');

      const refreshList = () => showSuggestions(picker, searchGames(input.value));
      input.addEventListener('focus', refreshList);
      input.addEventListener('input', refreshList);
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          hideSuggestions(picker);
          return;
        }
        if (event.key === 'Enter') {
          event.preventDefault();
          const first = list.querySelector('.compareSuggestion');
          if (first) selectSuggestion(picker, slot, first.dataset.gameId);
        }
      });
      list.addEventListener('mousedown', (event) => {
        const button = event.target.closest('.compareSuggestion');
        if (!button) return;
        event.preventDefault();
        selectSuggestion(picker, slot, button.dataset.gameId);
      });
      picker.querySelector('.compareClearBtn').addEventListener('click', () => {
        input.value = '';
        setCompareGame(slot, null);
      });
    });
    modalBody.querySelector('#compareSwapBtn').addEventListener('click', () => {
      const [leftId, rightId] = compareGameIds;
      compareGameIds[0] = rightId;
      compareGameIds[1] = leftId;
      refreshCompareSelection();
      openCompareModal();
    });
  }

  function openCompareModal() {
    openModal('Compare games', `
      <div class="compareTool">
        <div class="comparePickers">
          ${[0, 1].map(slot => {
            const game = getGameById(compareGameIds[slot]);
            return `
              <div class="comparePicker" data-slot="${slot}">
                <div class="comparePickerHeader">
                  <label>Game ${slot + 1}</label>
                  <button type="button" class="compareClearBtn secondary-btn">Clear</button>
                </div>
                <input type="text" class="compareSearchInput" placeholder="Type to search..." autocomplete="off" spellcheck="false">
                <ul class="compareSuggestions" hidden></ul>
                <div class="comparePicked">${game ? renderPickedGame(game) : '<p class="compareEmpty">No game selected</p>'}</div>
              </div>
            `;
          }).join('')}
          <button type="button" class="toolbar-btn compareSwapBtn" id="compareSwapBtn" title="Swap games">
            <span class="material-symbols-rounded icon-medium">swap_horiz</span>
          </button>
        </div>
        <div class="compareResult" id="compareResult"></div>
      </div>
    `, { wide: true });
    bindCompareModal();
    renderCompareResult();
  }

  function setupCompare() {
    document.getElementById('compareBtn').addEventListener('click', () => {
      if (compareModeActive) {
        exitCompareMode();
        return;
      }
      if (compareGameIds[0] && compareGameIds[1]) {
        openCompareModal();
        return;
      }
      setCompareMode(true);
    });
    document.getElementById('compareBannerCancel').addEventListener('click', exitCompareMode);
    document.getElementById('hits').addEventListener('click', (event) => {
      if (!compareModeActive) return;
      const card = event.target.closest('.game-card');
      if (!card) return;
      event.preventDefault();
      event.stopPropagation();
      const game = getGameById(card.dataset.gameId);
      if (game) pickCompareFromGrid(game);
    }, true);
  }

  const nightsStorageKey = 'playChestSavedNights';
  let savedNights = [];

  function snapshotFilters(filters) {
    return {
      query: filters.query || '',
      selectedCategories: filters.selectedCategories || [],
      selectedMechanics: filters.selectedMechanics || [],
      selectedBggStatus: filters.selectedBggStatus || [],
      selectedCollectionOwners: filters.selectedCollectionOwners || [],
      neverPlayedOnly: Boolean(filters.neverPlayedOnly),
      selectedPlayerFilter: filters.selectedPlayerFilter || 'any',
      selectedWeight: filters.selectedWeight || [],
      selectedPlayingTime: filters.selectedPlayingTime || [],
      selectedPreviousPlayers: filters.selectedPreviousPlayers || [],
      selectedMinAge: filters.selectedMinAge || null,
      selectedNumPlays: filters.selectedNumPlays || null,
      sortBy: filters.sortBy || 'name',
      viewMode: filters.viewMode || 'grid',
    };
  }

  function applyNightFilters(filters) {
    const app = getApp();
    const state = {
      ...snapshotFilters(filters),
      page: 1,
    };
    app.updateUIFromState(state);
    app.updateURLWithFilters(state);
    app.applyFiltersAndSort(state);
    app.updateResults();
    app.updateStats();
  }

  async function loadSavedNights() {
    try {
      const response = await fetch('/api/nights', { cache: 'no-store' });
      if (response.ok) {
        const payload = await response.json();
        savedNights = Array.isArray(payload.nights) ? payload.nights : [];
        localStorage.setItem(nightsStorageKey, JSON.stringify(savedNights));
        return;
      }
    } catch (error) {
      // fall through to localStorage
    }
    const localNights = localStorage.getItem(nightsStorageKey);
    savedNights = localNights ? JSON.parse(localNights) : [];
  }

  async function persistSavedNights() {
    localStorage.setItem(nightsStorageKey, JSON.stringify(savedNights));
    try {
      await fetch('/api/nights', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nights: savedNights }),
      });
    } catch (error) {
      console.warn('Could not persist nights to server, kept in localStorage.', error);
    }
  }

  function renderSavedNightsModal() {
    const listHtml = savedNights.length
      ? `<ul class="savedNightsList">${savedNights.map(night => `
          <li class="savedNightItem">
            <button type="button" class="primary-btn savedNightApplyBtn" data-night-id="${escapeHtml(night.id)}">${escapeHtml(night.name)}</button>
            <button type="button" class="secondary-btn savedNightDeleteBtn" data-night-id="${escapeHtml(night.id)}" title="Delete ${escapeHtml(night.name)}">Delete</button>
          </li>
        `).join('')}</ul>`
      : '<p class="compareHint">No saved nights yet. Set filters, name them, and save. Try names like “2 players”, “fillers”, or “heavy weekend”.</p>';

    openModal('Saved nights', `
      <div class="savedNightsTool">
        ${listHtml}
        <form class="savedNightsForm" id="savedNightsForm">
          <input type="text" id="savedNightName" placeholder="Name this night" maxlength="60" autocomplete="off">
          <button type="submit" class="primary-btn">Save current filters</button>
        </form>
      </div>
    `);

    document.getElementById('savedNightsForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const input = document.getElementById('savedNightName');
      const name = input.value.trim();
      if (!name) return;
      const filters = snapshotFilters(getApp().getFiltersFromUI());
      const existing = savedNights.find(night => night.name.toLowerCase() === name.toLowerCase());
      if (existing) {
        existing.filters = filters;
      } else {
        savedNights.push({
          id: `night-${Date.now()}`,
          name,
          filters,
        });
      }
      await persistSavedNights();
      renderSavedNightsModal();
    });

    modalBody.querySelectorAll('.savedNightApplyBtn').forEach(button => {
      button.addEventListener('click', () => {
        const night = savedNights.find(item => item.id === button.dataset.nightId);
        if (!night) return;
        applyNightFilters(night.filters);
        closeModal();
      });
    });

    modalBody.querySelectorAll('.savedNightDeleteBtn').forEach(button => {
      button.addEventListener('click', async () => {
        savedNights = savedNights.filter(night => night.id !== button.dataset.nightId);
        await persistSavedNights();
        renderSavedNightsModal();
      });
    });
  }

  function setupSavedNights() {
    const button = document.getElementById('nightsBtn');
    if (!button) return;
    button.addEventListener('click', () => {
      renderSavedNightsModal();
    });
    loadSavedNights();
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

  function enhanceVisibleGames() {
    const visibleIds = new Set(
      [...document.querySelectorAll('.game-card[data-game-id]')].map(card => String(card.dataset.gameId))
    );
    const pageGames = getApp().getAllGames().filter(game => visibleIds.has(String(game.id)));
    enhanceRenderedGames(pageGames);
  }

  function waitForAppReady() {
    if (window.gameCacheApp?.getAllGames()?.length) {
      setupRandomPicker();
      setupTonightWizard();
      setupStatsButton();
      setupCompare();
      setupSavedNights();
      setupViewToggle();
      loadPersonalNotes().then(() => enhanceVisibleGames());
      return;
    }
    setTimeout(waitForAppReady, 250);
  }

  window.gameCacheFeatures = {
    enhanceRenderedGames,
  };

  waitForAppReady();
})();
