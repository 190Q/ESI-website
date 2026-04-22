(function () {
  'use strict';

  var backdrop = document.getElementById('legalModalBackdrop');
  var closeBtn = document.getElementById('legalModalClose');
  if (!backdrop || !closeBtn) return;

  var modalEl = backdrop.querySelector('.legal-modal');
  var tabButtons = backdrop.querySelectorAll('.legal-tab');
  var sections = backdrop.querySelectorAll('.legal-section');
  var footerLinks = document.querySelectorAll('.site-footer [data-legal-tab]');

  window.Popup.register(backdrop, { closeBtn: closeBtn });

  function selectTab(name) {
    if (!name) return;
    tabButtons.forEach(function (btn) {
      var isActive = btn.getAttribute('data-legal-tab') === name;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
    sections.forEach(function (sec) {
      var isActive = sec.id === 'legalSection-' + name;
      sec.classList.toggle('active', isActive);
      if (isActive) {
        sec.removeAttribute('hidden');
      } else {
        sec.setAttribute('hidden', '');
      }
    });
    // scroll the body back to the top when switching tabs
    var body = backdrop.querySelector('.legal-body');
    if (body) body.scrollTop = 0;
  }

  function openLegal(tab) {
    selectTab(tab || 'privacy');
    window.Popup.open(backdrop);
  }
  function closeLegal() { window.Popup.close(backdrop); }

  // Expose openers so other modules can trigger the modal if needed.
  window.openLegalModal = openLegal;
  window.closeLegalModal = closeLegal;

  // Footer links open the modal on the matching tab.
  footerLinks.forEach(function (link) {
    link.addEventListener('click', function (e) {
      e.preventDefault();
      openLegal(link.getAttribute('data-legal-tab'));
    });
  });

  // Tab switching inside the modal.
  tabButtons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      selectTab(btn.getAttribute('data-legal-tab'));
    });
  });

  // Allow opening directly via hash (e.g. someone shares a deep link to #privacy).
  var validTabs = { privacy: 1, terms: 1, cookies: 1, notice: 1 };
  function handleHash() {
    var h = (window.location.hash || '').replace(/^#/, '');
    if (validTabs[h]) openLegal(h);
  }
  window.addEventListener('hashchange', handleHash);
  // Defer a tick so it doesn't race with any other startup hash logic.
  setTimeout(handleHash, 0);

  // Prevent clicks inside the modal content from bubbling to document listeners.
  if (modalEl) {
    modalEl.addEventListener('mousedown', function (e) { e.stopPropagation(); });
  }
})();
