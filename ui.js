// Interface layer for the redesigned layout: quick player/time filters,
// keyboard shortcuts, and dialog behaviour. It only drives the existing
// filter inputs, so URLs, saved nights and counts keep working unchanged.
(() => {
  const TIME_PRESETS = [
    { id: 'any', label: 'Any', values: [] },
    { id: 'short', label: '≤ 30m', values: ['< 30min'] },
    { id: 'hour', label: '≤ 1h', values: ['< 30min', '30min - 1h'] },
    { id: 'mid', label: '1–2h', values: ['1-2h'] },
    { id: 'long', label: '2h+', values: ['2-3h', '3-4h', '> 4h'] },
  ];
  const MAX_PLAYER_CHIPS = 8;

  const app = () => window.gameCacheApp;

  function chip(label, value, groupName) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'quickChip';
    button.dataset.value = value;
    button.setAttribute('role', 'radio');
    button.setAttribute('aria-checked', 'false');
    button.textContent = label;
    button.dataset.group = groupName;
    return button;
  }

  function groupLabel(text) {
    const span = document.createElement('span');
    span.className = 'quickLabel';
    span.textContent = text;
    return span;
  }

  function buildPlayerChips() {
    const group = document.getElementById('quickPlayers');
    if (!group) return;
    const values = [...document.querySelectorAll('#facet-players input[name="players"]')]
      .map(input => input.value)
      .filter(value => value === 'any' || /^\d+$/.test(value))
      .slice(0, MAX_PLAYER_CHIPS + 1);
    if (values.length < 2) return;
    group.replaceChildren(groupLabel('Players'));
    values.forEach(value => group.appendChild(chip(value === 'any' ? 'Any' : value, value, 'players')));
    group.hidden = false;
    group.addEventListener('click', event => {
      const button = event.target.closest('.quickChip');
      if (!button) return;
      const input = document.querySelector(`#facet-players input[name="players"][value="${CSS.escape(button.dataset.value)}"]`);
      if (!input) return;
      input.checked = true;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  function availableTimeValues() {
    return new Set([...document.querySelectorAll('input[name="playing_time"]')].map(input => input.value));
  }

  function buildTimeChips() {
    const group = document.getElementById('quickTime');
    if (!group) return;
    const available = availableTimeValues();
    if (!available.size) return;
    group.replaceChildren(groupLabel('Time'));
    TIME_PRESETS
      .filter(preset => !preset.values.length || preset.values.some(value => available.has(value)))
      .forEach(preset => group.appendChild(chip(preset.label, preset.id, 'time')));
    group.hidden = false;
    group.addEventListener('click', event => {
      const button = event.target.closest('.quickChip');
      if (!button) return;
      const preset = TIME_PRESETS.find(item => item.id === button.dataset.value);
      if (!preset) return;
      document.querySelectorAll('input[name="playing_time"]').forEach(input => {
        input.checked = preset.values.includes(input.value);
      });
      app().onFilterChange();
    });
  }

  function setChecked(group, matchValue) {
    group?.querySelectorAll('.quickChip').forEach(button => {
      const on = button.dataset.value === matchValue;
      button.classList.toggle('is-active', on);
      button.setAttribute('aria-checked', String(on));
    });
  }

  function hasActiveFilters(filters) {
    return Boolean(
      filters.query ||
      filters.selectedCategories?.length ||
      filters.selectedMechanics?.length ||
      filters.selectedBggStatus?.length ||
      filters.selectedCollectionOwners?.length ||
      filters.neverPlayedOnly ||
      (filters.selectedPlayerFilter && filters.selectedPlayerFilter !== 'any') ||
      filters.selectedWeight?.length ||
      filters.selectedPlayingTime?.length ||
      filters.selectedPreviousPlayers?.length ||
      filters.selectedMinAge ||
      filters.selectedNumPlays
    );
  }

  function sync() {
    if (!app()) return;
    const filters = app().getFiltersFromUI();

    const player = filters.selectedPlayerFilter || 'any';
    setChecked(document.getElementById('quickPlayers'), player.split('-')[0]);

    const selected = [...(filters.selectedPlayingTime || [])].sort().join('|');
    const available = availableTimeValues();
    const preset = TIME_PRESETS.find(item =>
      item.values.filter(value => available.has(value)).sort().join('|') === selected);
    setChecked(document.getElementById('quickTime'), preset ? preset.id : null);

    const clear = document.getElementById('quickClearBtn');
    if (clear) clear.hidden = !hasActiveFilters(filters);

    const apply = document.getElementById('filterSheetApply');
    if (apply) {
      const count = app().getFilteredGames().length;
      apply.textContent = count === 1 ? 'Show 1 game' : `Show ${count.toLocaleString()} games`;
    }
    window.gameCacheFeatures?.updateFilterCountBadge?.();
  }

  function isTyping(target) {
    return target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
  }

  function closeTopLayer() {
    const modal = document.getElementById('feature-modal');
    if (modal && !modal.hidden) {
      document.getElementById('feature-modal-close')?.click();
      return true;
    }
    const sheet = document.getElementById('filterSheet');
    if (sheet && !sheet.hidden) {
      sheet.hidden = true;
      document.getElementById('filtersBtn')?.focus();
      return true;
    }
    const openCard = document.querySelector('.game-card[open]');
    if (openCard) {
      openCard.open = false;
      openCard.querySelector('summary')?.focus();
      return true;
    }
    return false;
  }

  function setupKeyboard() {
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        if (closeTopLayer()) event.preventDefault();
        return;
      }
      if (event.key === '/' && !isTyping(event.target) && !event.metaKey && !event.ctrlKey) {
        const input = document.getElementById('search-input');
        if (input) {
          event.preventDefault();
          input.focus();
          input.select();
        }
      }
    });
  }

  function setupSheet() {
    const sheet = document.getElementById('filterSheet');
    document.getElementById('filterSheetApply')?.addEventListener('click', () => {
      sheet.hidden = true;
      document.getElementById('hits')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    });
    // Focus the panel when opened so keyboard and screen reader users land inside it.
    new MutationObserver(() => {
      if (!sheet.hidden) sheet.querySelector('.filterSheetPanel')?.focus();
    }).observe(sheet, { attributes: true, attributeFilter: ['hidden'] });

    const modal = document.getElementById('feature-modal');
    new MutationObserver(() => {
      if (!modal.hidden) document.getElementById('featureModalPanel')?.focus();
    }).observe(modal, { attributes: true, attributeFilter: ['hidden'] });

    document.getElementById('quickClearBtn')?.addEventListener('click', () => {
      if (typeof window.clearAllFilters === 'function') window.clearAllFilters();
    });
  }

  function init() {
    buildPlayerChips();
    buildTimeChips();
    setupSheet();
    setupKeyboard();
    const hits = document.getElementById('hits');
    new MutationObserver(sync).observe(hits, { childList: true });
    sync();
  }

  function waitForApp() {
    if (app()?.getAllGames()?.length && document.querySelector('#facet-players input')) {
      init();
      return;
    }
    setTimeout(waitForApp, 200);
  }

  waitForApp();
})();
