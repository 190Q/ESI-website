/**
 * website/cache/cache.js - the Website Cache panel.
 *
 * No build function: the shell renders the shared service console for every
 * type 'screen' item. Give it a build function only if this service needs a
 * body of its own.
 */
(function () {
  'use strict';

  window.ESIPanel.registerItem({
    section: 'website',
    order: 3,
    id: 'cache',
    type: 'screen',
    label: 'Website Cache',
    icon: 'server',
    subtitle: 'Manage the cache screen session.',
  });
})();
