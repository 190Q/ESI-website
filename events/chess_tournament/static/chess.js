/* Public chess tournament page: standings and brackets. */
(function () {
  'use strict';

  var API = '/api/events/chess/public';
  var STATUS_LABELS = {
    upcoming: 'Upcoming',
    ongoing: 'In progress',
    finished: 'Finished'
  };

  var countdownTimer = null;

  function byId(id) {
    return document.getElementById(id);
  }

  function text(node, value) {
    if (!node) return;
    node.textContent = value == null ? '' : String(value);
  }

  function show(node, visible) {
    if (!node) return;
    if (visible) node.removeAttribute('hidden');
    else node.setAttribute('hidden', 'hidden');
  }

  function parseDate(value) {
    if (!value) return null;
    var parsed = new Date(value);
    return isNaN(parsed.getTime()) ? null : parsed;
  }

  function formatDate(date) {
    try {
      return date.toLocaleString(undefined, {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (err) {
      return date.toISOString();
    }
  }

  function pad(value) {
    return value < 10 ? '0' + value : String(value);
  }

  function formatPoints(value) {
    var number = Number(value);
    if (!isFinite(number)) return '0';
    if (number % 1 === 0) return String(number);
    return number.toFixed(1);
  }

  function cell(className, value) {
    var node = document.createElement('td');
    node.className = className;
    node.textContent = value == null ? '' : String(value);
    return node;
  }

  /* Header */

  function tick(start) {
    var remaining = start.getTime() - Date.now();
    if (remaining <= 0) {
      stopCountdown();
      return;
    }
    var seconds = Math.floor(remaining / 1000);
    text(byId('ch-cd-days'), pad(Math.floor(seconds / 86400)));
    text(byId('ch-cd-hours'), pad(Math.floor((seconds % 86400) / 3600)));
    text(byId('ch-cd-minutes'), pad(Math.floor((seconds % 3600) / 60)));
    text(byId('ch-cd-seconds'), pad(seconds % 60));
  }

  function stopCountdown() {
    if (countdownTimer) {
      window.clearInterval(countdownTimer);
      countdownTimer = null;
    }
    show(byId('ch-countdown'), false);
  }

  function startCountdown(start) {
    stopCountdown();
    if (!start || start.getTime() <= Date.now()) return;
    show(byId('ch-countdown'), true);
    tick(start);
    countdownTimer = window.setInterval(function () {
      tick(start);
    }, 1000);
  }

  function renderHeader(data) {
    var event = data.event || {};
    text(byId('ch-title'), event.title || 'Chess Tournament');

    var description = byId('ch-description');
    if (event.description) {
      text(description, event.description);
      show(description, true);
    } else {
      show(description, false);
    }

    var statusKey = event.status || 'upcoming';
    var status = byId('ch-status');
    text(status, STATUS_LABELS[statusKey] || statusKey);
    status.className = 'ch-status ch-status-' + statusKey;

    var start = parseDate(event.starts_at);
    var startNode = byId('ch-start');
    if (!start) {
      show(startNode, false);
    } else {
      show(startNode, true);
      var prefix = start.getTime() > Date.now() ? 'Starts ' : 'Started ';
      text(startNode, prefix + formatDate(start));
    }
    startCountdown(start);
  }

  /* Players */

  function renderPlayers(players) {
    var card = byId('ch-players-card');
    var body = byId('ch-players-body');
    body.textContent = '';

    if (!players || !players.length) {
      show(card, false);
      return;
    }
    show(card, true);

    players.forEach(function (player, index) {
      var tr = document.createElement('tr');
      if (player.withdrawn) tr.className = 'ch-row-withdrawn';

      tr.appendChild(cell('ch-rank', index + 1));

      var nameCell = document.createElement('td');
      var name = document.createElement('span');
      name.className = 'ch-player-name';
      name.textContent = player.name;
      nameCell.appendChild(name);

      if (player.withdrawn) {
        var withdrawn = document.createElement('span');
        withdrawn.className = 'ch-tag';
        withdrawn.textContent = 'Withdrawn';
        nameCell.appendChild(withdrawn);
      }
      tr.appendChild(nameCell);

      tr.appendChild(cell('ch-num', player.rating || ''));
      body.appendChild(tr);
    });
  }

  /* Standings */

  function renderStandings(rows) {
    var card = byId('ch-standings-card');
    var body = byId('ch-standings-body');
    body.textContent = '';

    if (!rows || !rows.length) {
      show(card, false);
      return;
    }
    show(card, true);

    rows.forEach(function (row) {
      var tr = document.createElement('tr');
      if (row.rank <= 3) tr.className = 'ch-row-podium';
      if (row.withdrawn) tr.className += ' ch-row-withdrawn';

      tr.appendChild(cell('ch-rank', row.rank));

      var nameCell = document.createElement('td');
      var name = document.createElement('span');
      name.className = 'ch-player-name';
      name.textContent = row.name;
      nameCell.appendChild(name);

      if (row.rating) {
        var rating = document.createElement('span');
        rating.className = 'ch-tag';
        rating.textContent = row.rating;
        nameCell.appendChild(rating);
      }
      if (row.withdrawn) {
        var withdrawn = document.createElement('span');
        withdrawn.className = 'ch-tag';
        withdrawn.textContent = 'Withdrawn';
        nameCell.appendChild(withdrawn);
      }
      tr.appendChild(nameCell);

      tr.appendChild(cell('ch-num ch-points', formatPoints(row.points)));
      tr.appendChild(cell('ch-num', formatPoints(row.buchholz_cut1)));
      tr.appendChild(cell('ch-num', row.wins));
      tr.appendChild(cell('ch-num', row.draws));
      tr.appendChild(cell('ch-num', row.losses));
      tr.appendChild(cell('ch-num', row.byes));
      body.appendChild(tr);
    });
  }

  /* Brackets */

  function playerNode(name, extraClass, winner) {
    var node = document.createElement('span');
    var classes = 'ch-board-player';
    if (extraClass) classes += ' ' + extraClass;
    if (winner) classes += ' ch-winner';
    if (!name) classes += ' ch-empty';
    node.className = classes;
    node.textContent = name || 'Unassigned';
    return node;
  }

  function boardNumber(value) {
    var node = document.createElement('span');
    node.className = 'ch-board-num';
    node.textContent = value;
    return node;
  }

  function resultLabel(result) {
    if (result === 'white') return '1 - 0';
    if (result === 'black') return '0 - 1';
    if (result === 'draw') return '\u00bd - \u00bd';
    return 'Not played';
  }

  function boardNode(board) {
    var item = document.createElement('li');

    if (board.bye) {
      item.className = 'ch-board ch-board-bye';
      item.appendChild(boardNumber(board.board));
      item.appendChild(playerNode(board.bye, ''));
      var byeResult = document.createElement('span');
      byeResult.className = 'ch-board-result';
      byeResult.textContent = 'Bye +1';
      item.appendChild(byeResult);
      return item;
    }

    item.className = 'ch-board';
    item.appendChild(boardNumber(board.board));
    item.appendChild(playerNode(board.white, 'ch-white', board.result === 'white'));

    var result = document.createElement('span');
    result.className = 'ch-board-result' + (board.result ? '' : ' ch-result-pending');
    result.textContent = resultLabel(board.result);
    item.appendChild(result);

    item.appendChild(playerNode(board.black, 'ch-black', board.result === 'black'));
    return item;
  }

  function renderRounds(rounds) {
    var card = byId('ch-rounds-card');
    var wrap = byId('ch-rounds');
    wrap.textContent = '';

    if (!rounds || !rounds.length) {
      show(card, false);
      return;
    }
    show(card, true);

    rounds.forEach(function (round) {
      var box = document.createElement('div');
      box.className = 'ch-round';

      var head = document.createElement('div');
      head.className = 'ch-round-head';
      var title = document.createElement('span');
      title.className = 'ch-round-title';
      title.textContent = 'Round ' + round.number;
      var state = document.createElement('span');
      state.className = 'ch-round-state';
      state.textContent = round.complete ? 'Complete' : 'In progress';
      head.appendChild(title);
      head.appendChild(state);
      box.appendChild(head);

      var list = document.createElement('ul');
      list.className = 'ch-boards';
      (round.boards || []).forEach(function (board) {
        list.appendChild(boardNode(board));
      });
      box.appendChild(list);
      wrap.appendChild(box);
    });
  }

  /* Entry point */

  function render(data) {
    renderHeader(data);

    if ((data.event || {}).status === 'upcoming') {
      // Only the roster is public until the event starts, the pairings stay hidden.
      show(byId('ch-empty'), !data.has_brackets);
      show(byId('ch-standings-card'), false);
      show(byId('ch-rounds-card'), false);
      renderPlayers(data.players);
      return;
    }

    show(byId('ch-players-card'), false);

    if (!data.has_brackets) {
      show(byId('ch-empty'), true);
      show(byId('ch-standings-card'), false);
      show(byId('ch-rounds-card'), false);
      return;
    }
    show(byId('ch-empty'), false);
    renderStandings(data.standings);
    renderRounds(data.rounds);
  }

  function renderError(message) {
    stopCountdown();
    text(byId('ch-status'), 'Unavailable');
    show(byId('ch-status'), true);
    show(byId('ch-empty'), false);
    show(byId('ch-players-card'), false);
    show(byId('ch-standings-card'), false);
    show(byId('ch-rounds-card'), false);
    var node = byId('ch-error');
    text(node, message);
    show(node, true);
  }

  fetch(API, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
    .then(function (response) {
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return response.json();
    })
    .then(render)
    .catch(function () {
      renderError('The tournament could not be loaded right now. Please refresh the page.');
    });
})();
