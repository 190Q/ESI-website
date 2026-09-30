/**
 * bots/q-bot/q-bot.js - the Q-Bot panel.
 *
 * No build function: the shell renders the shared service console for every
 * type 'screen' item. Give it a build function only if this service needs a
 * body of its own.
 */
(function () {
  'use strict';

  window.ESIPanel.registerItem({
    section: 'bots',
    order: 1,
    id: 'q-bot',
    type: 'screen',
    label: 'Q-Bot',
    icon: 'bot',
    subtitle: 'Manage the q-bot screen session.',
  });
})();
