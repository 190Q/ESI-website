/**
 * bots/esi-bot/esi-bot.js - the ESI-Bot panel.
 *
 * No build function: the shell renders the shared service console for every
 * type 'screen' item. Give it a build function only if this service needs a
 * body of its own.
 */
(function () {
  'use strict';

  window.ESIPanel.registerItem({
    section: 'bots',
    order: 2,
    id: 'esi-bot',
    type: 'screen',
    label: 'ESI-Bot',
    icon: 'bot',
    subtitle: 'Manage the esi-bot screen session.',
  });
})();
