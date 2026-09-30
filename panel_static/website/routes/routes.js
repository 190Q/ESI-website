/**
 * website/routes/routes.js - the Website Routes panel.
 *
 * No build function: the shell renders the shared service console for every
 * type 'screen' item. Give it a build function only if this service needs a
 * body of its own.
 */
(function () {
  'use strict';

  window.ESIPanel.registerItem({
    section: 'website',
    order: 2,
    id: 'routes',
    type: 'screen',
    label: 'Website Routes',
    icon: 'server',
    subtitle: 'Manage the routes screen session.',
  });
})();
