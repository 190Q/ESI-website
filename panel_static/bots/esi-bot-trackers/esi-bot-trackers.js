/**
 * bots/esi-bot-trackers/esi-bot-trackers.js - the ESI-Bot Trackers panel.
 *
 * No build function: the shell renders the shared service console for every
 * type 'screen' item. Give it a build function only if this service needs a
 * body of its own.
 */
(function () {
  'use strict';

  window.ESIPanel.registerItem({
    section: 'bots',
    order: 3,
    id: 'esi-bot-trackers',
    type: 'screen',
    label: 'ESI-Bot Trackers',
    icon: 'bot',
    subtitle: 'Manage the esi-bot-trackers screen session.',
  });
})();
