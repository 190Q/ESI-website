/* Chess tournament manager dashboard. */
(function () {
  'use strict';

  var API = '/api/events/chess/manage';
  var RESULTS = [
    { value: 'white', label: '1-0' },
    { value: 'draw', label: '\u00bd-\u00bd' },
    { value: 'black', label: '0-1' }
  ];
  var SLOT_LABELS = { white: 'White', black: 'Black', bye: 'Bye' };
  var STATUS_LABELS = {
    upcoming: 'Upcoming',
    ongoing: 'In progress',
    finished: 'Finished'
  };

  var state = null;

  function byId(id) {
    return document.getElementById(id);
  }

  function show(node, visible) {
    if (!node) return;
    if (visible) node.removeAttribute('hidden');
    else node.setAttribute('hidden', 'hidden');
  }

  function text(node, value) {
    if (!node) return;
    node.textContent = value == null ? '' : String(value);
  }

  function formatPoints(value) {
    var number = Number(value);
    if (!isFinite(number)) return '0';
    if (number % 1 === 0) return String(number);
    return number.toFixed(1);
  }

  function plural(count, word) {
    return count + ' ' + word + (count === 1 ? '' : 's');
  }

  function toast(message, kind) {
    if (typeof window.showToast === 'function') window.showToast(message, kind);
  }

  function el(tag, className, value) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (value != null) node.textContent = String(value);
    return node;
  }

  function makeButton(label, className, handler, disabled) {
    var button = el('button', 'cm-btn ' + className, label);
    button.type = 'button';
    if (disabled) button.disabled = true;
    button.addEventListener('click', handler);
    return button;
  }

  /* API */

  function callApi(path, options) {
    options = options || {};
    var init = {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' }
    };
    if (options.method) init.method = options.method;
    if (options.method) {
      init.headers['Content-Type'] = 'application/json';
      init.headers['X-Requested-With'] = 'XMLHttpRequest';
      init.body = JSON.stringify(options.body || {});
    }
    return fetch(API + path, init).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (data) {
        if (!response.ok) {
          throw new Error(data.error || 'The request failed (HTTP ' + response.status + ').');
        }
        return data;
      });
    });
  }

  function applyState(next) {
    state = next;
    renderAll();
  }

  function run(path, method, body) {
    return callApi(path, { method: method, body: body }).then(function (data) {
      applyState(data);
      return data;
    }).catch(function (error) {
      toast(error.message || 'Something went wrong.', 'error');
      throw error;
    });
  }

  function refresh() {
    return callApi('/state').then(applyState);
  }

  /* Confirm modal */

  var confirmHandler = null;

  function askConfirm(title, message, handler) {
    confirmHandler = handler;
    text(byId('cm-confirm-title'), title);
    text(byId('cm-confirm-text'), message);
    if (window.Popup) window.Popup.open(byId('cm-confirm-backdrop'));
  }

  function initConfirm() {
    var backdrop = byId('cm-confirm-backdrop');
    if (window.Popup) {
      window.Popup.register(backdrop, { closeBtn: '#cm-confirm-close' });
    }
    byId('cm-confirm-cancel').addEventListener('click', function () {
      if (window.Popup) window.Popup.close(backdrop);
    });
    byId('cm-confirm-ok').addEventListener('click', function () {
      var handler = confirmHandler;
      confirmHandler = null;
      if (window.Popup) window.Popup.close(backdrop);
      if (handler) handler();
    });
  }

  /* Header and stats */

  function renderHeader() {
    var event = state.event || {};
    var pill = byId('cm-status-pill');
    var statusKey = event.status || 'upcoming';
    text(pill, STATUS_LABELS[statusKey] || statusKey);
    pill.className = 'cm-status-pill cm-status-' + statusKey;
  }

  function renderStats() {
    var players = state.players || [];
    var withdrawn = players.filter(function (player) { return player.withdrawn; }).length;
    var active = players.length - withdrawn;

    text(byId('cm-stat-players'), players.length);
    text(byId('cm-stat-players-sub'), withdrawn
      ? withdrawn + ' withdrawn of ' + players.length
      : (players.length ? active + ' active' : 'none registered'));

    var roundsPlayed = state.rounds_played || 0;
    var roundsPlanned = state.rounds_planned || 0;
    text(byId('cm-stat-rounds'), roundsPlayed);
    text(byId('cm-stat-rounds-sub'), 'of ' + roundsPlanned + ' planned');

    var decided = 0;
    var total = 0;
    (state.rounds || []).forEach(function (round) {
      (round.matches || []).forEach(function (match) {
        if (match.bye) return;
        if (!match.white || !match.black) return;
        total += 1;
        if (match.result) decided += 1;
      });
    });
    text(byId('cm-stat-boards'), decided);
    text(byId('cm-stat-boards-sub'),
      total ? decided + ' of ' + plural(total, 'board') : 'no round generated');

    var standings = state.standings || [];
    var leader = standings.length ? standings[0] : null;
    if (leader && leader.points > 0) {
      text(byId('cm-stat-leader'), leader.name);
      text(byId('cm-stat-leader-sub'), formatPoints(leader.points) + ' points');
    } else {
      text(byId('cm-stat-leader'), '\u2013');
      text(byId('cm-stat-leader-sub'), 'no games played');
    }
  }

  /* Event form */

  function renderEventForm() {
    var event = state.event || {};
    byId('cm-event-title').value = event.title || '';
    byId('cm-event-description').value = event.description || '';
    byId('cm-event-starts').value = event.starts_at || '';
    byId('cm-event-ends').value = event.ends_at || '';
    byId('cm-event-rounds').value = event.rounds || 0;
    byId('cm-event-status').value = event.status_override || '';
    text(byId('cm-event-rounds-hint'),
      'Leave the rounds at 0 to use the default of ' + (state.default_rounds || 3) +
      ' rounds for ' + plural(state.active_players || 0, 'active player') + '.');
  }

  function submitEvent(eventSubmit) {
    eventSubmit.preventDefault();
    run('/event', 'POST', {
      title: byId('cm-event-title').value,
      description: byId('cm-event-description').value,
      starts_at: byId('cm-event-starts').value,
      ends_at: byId('cm-event-ends').value,
      rounds: Number(byId('cm-event-rounds').value) || 0,
      status_override: byId('cm-event-status').value
    }).then(function () { toast('Event settings saved.', 'success'); });
  }

  /* Players */

  function renderPlayers() {
    var players = (state.players || []).slice().sort(function (a, b) {
      if (a.withdrawn !== b.withdrawn) return a.withdrawn ? 1 : -1;
      return String(a.name).toLowerCase().localeCompare(String(b.name).toLowerCase());
    });
    var body = byId('cm-players-body');
    body.textContent = '';
    show(byId('cm-players-empty'), players.length === 0);
    text(byId('cm-players-hint'), plural(players.length, 'player') + ' registered');

    players.forEach(function (player) {
      var row = el('tr', player.withdrawn ? 'cm-row-withdrawn' : '');

      var nameCell = el('td');
      var nameInput = el('input', 'cm-input cm-cell-input');
      nameInput.maxLength = 32;
      nameInput.value = player.name;
      nameInput.autocomplete = 'off';
      nameInput.setAttribute('aria-label', 'Player name');
      nameCell.appendChild(nameInput);
      row.appendChild(nameCell);

      var ratingCell = el('td');
      var ratingInput = el('input', 'cm-input cm-cell-number');
      ratingInput.type = 'number';
      ratingInput.min = '0';
      ratingInput.max = '4000';
      ratingInput.value = player.rating || 0;
      ratingInput.setAttribute('aria-label', 'Rating');
      ratingCell.appendChild(ratingInput);
      row.appendChild(ratingCell);

      var statusCell = el('td');
      statusCell.appendChild(el('span',
        'cm-tag ' + (player.withdrawn ? 'cm-tag-out' : 'cm-tag-active'),
        player.withdrawn ? 'Withdrawn' : 'Playing'));
      row.appendChild(statusCell);

      var actions = el('td');
      var actionWrap = el('div', 'cm-cell-actions');
      actionWrap.appendChild(makeButton('Save', 'cm-btn-ghost cm-btn-mini', function () {
        run('/players/' + encodeURIComponent(player.id), 'PATCH', {
          name: nameInput.value,
          rating: ratingInput.value
        }).then(function () { toast('Player updated.', 'success'); });
      }));
      actionWrap.appendChild(makeButton(player.withdrawn ? 'Reactivate' : 'Withdraw',
        'cm-btn-ghost cm-btn-mini', function () {
          run('/players/' + encodeURIComponent(player.id), 'PATCH', {
            withdrawn: !player.withdrawn
          }).then(function () {
            toast(player.withdrawn ? 'Player is back in the pool.' : 'Player withdrawn.', 'success');
          });
        }));
      actionWrap.appendChild(makeButton('Remove', 'cm-btn-ghost cm-btn-mini', function () {
        askConfirm('Remove player',
          'Remove ' + player.name + ' from the tournament? This only works while they have no games.',
          function () {
            run('/players/' + encodeURIComponent(player.id), 'DELETE').then(function () {
              toast(player.name + ' removed.', 'success');
            });
          });
      }));
      actions.appendChild(actionWrap);
      row.appendChild(actions);

      body.appendChild(row);
    });
  }

  function addPlayers() {
    var textarea = byId('cm-import-text');
    var content = textarea.value.trim();
    if (!content) {
      toast('Paste at least one player name first.', 'warn');
      return;
    }
    run('/players', 'POST', { text: content }).then(function (data) {
      var added = (data && data.added) || [];
      var skipped = (data && data.skipped) || [];
      if (added.length) toast('Added ' + plural(added.length, 'player') + '.', 'success');
      if (skipped.length) {
        toast('Skipped ' + skipped.join(', ') + ' (duplicates or the roster is full).', 'warn');
      }
      textarea.value = '';
    });
  }

  /* Brackets */

  function playerName(id) {
    var players = state.players || [];
    for (var i = 0; i < players.length; i++) {
      if (players[i].id === id) return players[i].name;
    }
    return '';
  }

  function renderBrackets() {
    var rounds = state.rounds || [];
    var wrap = byId('cm-rounds');
    wrap.textContent = '';
    show(byId('cm-rounds-empty'), rounds.length === 0);

    text(byId('cm-rounds-hint'), rounds.length
      ? rounds.length + ' of ' + (state.rounds_planned || 0) + ' rounds generated'
      : 'No rounds yet');

    var generate = byId('cm-generate');
    generate.disabled = !state.can_generate;
    var roundsPlayed = state.rounds_played || 0;
    generate.textContent = roundsPlayed === 0
      ? 'Generate round 1'
      : 'Generate round ' + (roundsPlayed + 1);

    var lastRound = rounds.length ? rounds[rounds.length - 1] : null;
    var deletable = !!lastRound && !(lastRound.matches || []).some(function (match) {
      return !!match.result;
    });
    byId('cm-delete-round').disabled = !deletable;

    rounds.forEach(function (round) {
      wrap.appendChild(roundNode(round));
    });

    populateSwapSelects();
  }

  function slotNode(label, playerId, winner) {
    var slot = el('div', 'cm-slot' + (label === 'White' ? ' cm-slot-white' : ''));
    slot.appendChild(el('span', 'cm-slot-colour', label));
    var name = el('span', 'cm-slot-name');
    if (!playerId) name.classList.add('cm-slot-empty');
    if (winner) name.classList.add('cm-slot-winner');
    name.textContent = playerName(playerId) || (playerId ? 'Removed player' : 'Unassigned');
    slot.appendChild(name);
    return slot;
  }

  function roundNode(round) {
    var box = el('div', 'cm-round');

    var head = el('div', 'cm-round-head');
    head.appendChild(el('span', 'cm-round-title', 'Round ' + round.number));
    head.appendChild(el('span',
      'cm-round-state' + (round.complete ? ' cm-round-complete' : ''),
      round.complete ? 'Complete' : 'In progress'));
    box.appendChild(head);

    (round.matches || []).forEach(function (match) {
      box.appendChild(matchNode(match));
    });
    return box;
  }

  function matchNode(match) {
    var row = el('div', 'cm-board');

    row.appendChild(el('span', 'cm-board-num', match.board));

    if (match.bye) {
      row.classList.add('cm-board-bye');
      var byeSlot = el('div', 'cm-slot');
      byeSlot.appendChild(el('span', 'cm-slot-colour', 'Bye'));
      byeSlot.appendChild(el('span', 'cm-slot-name', playerName(match.bye) || 'Unassigned'));
      row.appendChild(byeSlot);

      row.appendChild(makeButton('Unassign', 'cm-btn-ghost cm-btn-mini', function () {
        askConfirm('Clear bye', 'Clear the bye on board ' + match.board + '?', function () {
          run('/matches/' + encodeURIComponent(match.id), 'PATCH', { bye: null });
        });
      }));
      return row;
    }

    row.appendChild(slotNode('White', match.white, match.result === 'white'));

    var results = el('div', 'cm-result-group');
    RESULTS.forEach(function (entry) {
      var button = el('button',
        'cm-result-btn' + (match.result === entry.value ? ' cm-result-active' : ''),
        entry.label);
      button.type = 'button';
      button.disabled = !match.white || !match.black;
      button.addEventListener('click', function () {
        run('/matches/' + encodeURIComponent(match.id), 'PATCH', { result: entry.value });
      });
      results.appendChild(button);
    });
    row.appendChild(results);

    row.appendChild(slotNode('Black', match.black, match.result === 'black'));

    var actions = el('div', 'cm-cell-actions');
    actions.appendChild(makeButton('Flip colours', 'cm-btn-ghost cm-btn-mini', function () {
      run('/matches/' + encodeURIComponent(match.id), 'PATCH', { flip: true });
    }));
    if (match.result) {
      actions.appendChild(makeButton('Clear', 'cm-btn-ghost cm-btn-mini', function () {
        run('/matches/' + encodeURIComponent(match.id), 'PATCH', { result: null });
      }));
    }
    row.appendChild(actions);
    return row;
  }

  /* Swap players */

  function swapChoices() {
    var latest = (state.rounds || [])[(state.rounds || []).length - 1];
    var choices = [];
    if (!latest) return choices;
    (latest.matches || []).forEach(function (match) {
      ['white', 'black', 'bye'].forEach(function (slot) {
        var playerId = match[slot];
        if (!playerId) return;
        choices.push({
          matchId: match.id,
          slot: slot,
          label: 'B' + match.board + ' ' + SLOT_LABELS[slot] + ': ' + (playerName(playerId) || 'Removed player')
        });
      });
    });
    return choices;
  }

  function populateSwapSelects() {
    var from = byId('cm-swap-from');
    var to = byId('cm-swap-to');
    var choices = swapChoices();
    [from, to].forEach(function (select) {
      select.textContent = '';
      choices.forEach(function (choice, index) {
        var option = el('option', '', choice.label);
        option.value = index;
        select.appendChild(option);
      });
    });
    byId('cm-swap-btn').disabled = choices.length < 2;
  }

  function performSwap() {
    var choices = swapChoices();
    var from = choices[Number(byId('cm-swap-from').value)];
    var to = choices[Number(byId('cm-swap-to').value)];
    if (!from || !to || (from.matchId === to.matchId && from.slot === to.slot)) {
      toast('Pick two different slots.', 'warn');
      return;
    }
    run('/matches/swap', 'POST', {
      from: { match_id: from.matchId, slot: from.slot },
      to: { match_id: to.matchId, slot: to.slot }
    }).then(function () { toast('Players swapped.', 'success'); });
  }

  /* Danger zone */

  function confirmReset(scope) {
    var message = scope === 'all'
      ? 'Remove every player, bracket and event setting? This cannot be undone.'
      : 'Clear every result while keeping the players and the pairings?';
    askConfirm(scope === 'all' ? 'Reset the tournament' : 'Clear results', message, function () {
      run('/reset', 'POST', { scope: scope }).then(function () {
        toast(scope === 'all' ? 'Tournament reset.' : 'Results cleared.', 'success');
      });
    });
  }

  /* Render */

  function renderAll() {
    renderHeader();
    renderStats();
    renderEventForm();
    renderPlayers();
    renderBrackets();
  }

  /* Boot */

  function boot() {
    byId('cm-event-form').addEventListener('submit', submitEvent);
    byId('cm-import-btn').addEventListener('click', addPlayers);
    byId('cm-generate').addEventListener('click', function () {
      run('/rounds', 'POST').then(function () { toast('Round paired.', 'success'); });
    });
    byId('cm-delete-round').addEventListener('click', function () {
      var rounds = state.rounds || [];
      var last = rounds.length ? rounds[rounds.length - 1] : null;
      if (!last) return;
      askConfirm('Delete round', 'Delete round ' + last.number + '? This only works before any results are entered.', function () {
        run('/rounds/' + last.number, 'DELETE').then(function () {
          toast('Round ' + last.number + ' deleted.', 'success');
        });
      });
    });
    byId('cm-swap-toggle').addEventListener('click', function () {
      var box = byId('cm-swap');
      show(box, box.hasAttribute('hidden'));
    });
    byId('cm-swap-btn').addEventListener('click', performSwap);
    byId('cm-refresh').addEventListener('click', function () {
      refresh().then(function () { toast('Tournament refreshed.', 'success'); })
        .catch(function (error) { toast(error.message, 'error'); });
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-reset]'), function (button) {
      button.addEventListener('click', function () {
        confirmReset(button.getAttribute('data-reset'));
      });
    });
    initConfirm();

    callApi('/state')
      .then(function (data) {
        applyState(data);
        show(byId('cm-loading'), false);
        show(byId('cm-app'), true);
      })
      .catch(function (error) {
        var note = byId('cm-loading').querySelector('.cm-loading-text');
        if (note) note.textContent = error.message || 'Could not load the tournament.';
      });
  }

  boot();
})();
