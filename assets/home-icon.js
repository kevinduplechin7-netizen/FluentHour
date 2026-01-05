/* FluentHour / Sentence Paths — Home icon shortcut (UI-only)
   Makes the brand icon act like a “go home” shortcut by clicking
   the app's existing Exit / Return home buttons.
   - Does NOT touch compiled bundles.
   - Does NOT reimplement logic.
   - If no matching button is found, it does nothing.
*/

(() => {
  'use strict';

  const BRAND_SELECTOR = '.fh-brand';
  const READY = () => document.querySelector(BRAND_SELECTOR);

  function isVisible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function findButtonByText(text) {
    const buttons = Array.from(document.querySelectorAll('button'));
    for (const b of buttons) {
      const t = (b.textContent || '').trim();
      if (t === text && !b.disabled && isVisible(b)) return b;
    }
    return null;
  }

  function goHomeViaExistingControls() {
    // Prefer the explicit home-return button when present.
    const returnHome = findButtonByText('Return home');
    if (returnHome) {
      returnHome.click();
      return true;
    }

    // During a running session, the header has an Exit button.
    const exit = findButtonByText('Exit');
    if (exit) {
      exit.click();
      return true;
    }

    return false;
  }

  function enhanceBrand(el) {
    if (!el || el.dataset.fhHomeEnhanced === '1') return;
    el.dataset.fhHomeEnhanced = '1';

    // Make it keyboard reachable without changing visible text.
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.setAttribute('aria-label', 'Home');

    el.addEventListener('click', (e) => {
      // Only act if we can safely find a matching in-app control.
      const ok = goHomeViaExistingControls();
      if (ok) {
        e.preventDefault();
        e.stopPropagation();
      }
    }, { capture: true });

    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        const ok = goHomeViaExistingControls();
        if (ok) {
          e.preventDefault();
          e.stopPropagation();
        }
      }
    }, { capture: true });
  }

  function tick() {
    const el = READY();
    if (el) enhanceBrand(el);
  }

  function start() {
    tick();
    const obs = new MutationObserver(() => tick());
    obs.observe(document.documentElement, { subtree: true, childList: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
