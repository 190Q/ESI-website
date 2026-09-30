/**
 * website/gateway/gateway.js - the Website Gateway panel.
 *
 * No build function: the shell renders the shared service console for every
 * type 'screen' item. Give it a build function only if this service needs a
 * body of its own.
 */
(function () {
  'use strict';

  window.ESIPanel.registerItem({
    section: 'website',
    order: 1,
    id: 'gateway',
    type: 'screen',
    label: 'Website Gateway',
    icon: 'server',
    subtitle: 'Manage the gateway screen session.',
  });
})();
