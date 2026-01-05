/* FluentHour / Sentence Paths — Phase Tools (UI-only overlay)
   Adds: Copy Phase / FluentHour Companion / Help modal
   Safe: no bundle edits, no business logic changes. */
(() => {
  'use strict';

  const COMPANION_URL = 'https://chatgpt.com/g/g-6958040e8ce881918400c643c84bbfc1-fluenthour-companion';
  const INJECT_ATTR = 'data-fh-phase-tools';
  const TOOLBAR_ID = 'fh-phase-tools-bar';
  const HELP_ID = 'fh-phase-tools-help';

  const phaseRegexes = [
    /\bphase\b/i,
    /\bminutes?\s*:/i,
    /\[phase\]/i,
    /\[steps\]/i,
    /\blearner\b/i,
    /\bhelper\b/i,
    /\bprompts?\b/i
  ];

  function isVisible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function scorePhaseCard(el) {
    const t = (el.innerText || '').trim();
    if (!t) return 0;
    let s = 0;
    if (/\bphase\b/i.test(t)) s += 3;
    if (/\bphase\s+(one|two|three|four|five|six|seven|eight|nine|ten|\d+)/i.test(t)) s += 3;
    if (/\bof\s+\d+\b/i.test(t)) s += 1;
    if (/\bminutes?\s*:/i.test(t)) s += 2;
    if (/\blearner\b/i.test(t) || /\[learner\]/i.test(t)) s += 1;
    if (/\bhelper\b/i.test(t) || /\[helper\]/i.test(t)) s += 1;
    if (/\bprompts?\b/i.test(t) || /\[prompts\]/i.test(t)) s += 1;
    if (/\bsteps?\b/i.test(t) || /\[steps\]/i.test(t)) s += 1;
    return s;
  }

  function findPhaseCard() {
    const cards = Array.from(document.querySelectorAll('.fh-card'));
    let best = null;
    let bestScore = 0;
    for (const c of cards) {
      if (!isVisible(c)) continue;
      const s = scorePhaseCard(c);
      if (s > bestScore) {
        bestScore = s;
        best = c;
      }
    }
    if (best && bestScore >= 4) return best;

    for (const c of cards) {
      if (!isVisible(c)) continue;
      const t = (c.innerText || '').toLowerCase();
      let hits = 0;
      for (const rx of phaseRegexes) if (rx.test(t)) hits++;
      if (hits >= 3) return c;
    }
    return null;
  }

  function ensureToolbar(card) {
    if (!card || card.getAttribute(INJECT_ATTR) === '1') return;
    card.setAttribute(INJECT_ATTR, '1');

    const header = card.querySelector('.fh-card-header') || card.querySelector('h1, h2, h3') || card.firstElementChild;
    const bar = document.createElement('div');
    bar.id = TOOLBAR_ID;
    bar.className = 'fh-phase-tools';
    bar.innerHTML = `
      <div class="fh-phase-tools__left">
        <button type="button" class="fh-phase-tools__btn" data-action="copy-phase">Copy Phase</button>
        <button type="button" class="fh-phase-tools__btn fh-phase-tools__btn--primary" data-action="open-companion">FluentHour Companion</button>
        <button type="button" class="fh-phase-tools__icon" aria-label="Help" title="Help" data-action="help">?</button>
      </div>
      <div class="fh-phase-tools__right" aria-live="polite"></div>
    `.trim();

    if (header && header.parentElement === card) {
      header.insertAdjacentElement('afterend', bar);
    } else {
      card.insertAdjacentElement('afterbegin', bar);
    }
  }

  function cleanText(s) {
    return (s || '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function extractPhaseText(card) {
    if (!card) return '';
    const clone = card.cloneNode(true);
    clone.querySelectorAll('#' + TOOLBAR_ID + ', .fh-phase-tools, .fh-phase-toast, #' + HELP_ID).forEach(n => n.remove());
    clone.querySelectorAll('[data-fh-injected="1"]').forEach(n => n.remove());
    const text = cleanText(clone.innerText || clone.textContent || '');
    return text;
  }

  async function copyToClipboard(text) {
    if (!text) return false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (_) {}

    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      ta.style.top = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return !!ok;
    } catch (_) {
      return false;
    }
  }

  function showToast(card, msg) {
    const bar = card ? card.querySelector('.fh-phase-tools__right') : null;
    if (!bar) return;
    bar.textContent = msg;
    bar.classList.add('fh-phase-toast');
    window.clearTimeout(showToast._t);
    showToast._t = window.setTimeout(() => {
      bar.textContent = '';
      bar.classList.remove('fh-phase-toast');
    }, 1400);
  }

  function openHelp() {
    if (document.getElementById(HELP_ID)) return;

    const backdrop = document.createElement('div');
    backdrop.id = HELP_ID;
    backdrop.className = 'fh-phase-help-backdrop';
    backdrop.setAttribute('data-fh-injected', '1');
    backdrop.innerHTML = `
      <div class="fh-phase-help" role="dialog" aria-modal="true" aria-label="Phase tools help">
        <div class="fh-phase-help__hdr">
          <div class="fh-phase-help__title">Phase tools</div>
          <button type="button" class="fh-phase-help__close" aria-label="Close help" data-action="close-help">×</button>
        </div>
        <div class="fh-phase-help__body">
          <p><strong>A “phase”</strong> is a self-contained chunk of a Perfect Hour session (title + guidance + steps + prompts).</p>
          <p><strong>Copy Phase</strong> copies the whole current phase as plain text so you can save or share it.</p>
          <p><strong>FluentHour Companion</strong> copies the phase and opens the Companion GPT in a new tab — then you paste to run the phase with an AI.</p>
          <div class="fh-phase-help__howto">
            <div class="fh-phase-help__howtoTitle">How to use</div>
            <ol>
              <li>Open a session and a phase.</li>
              <li>Click <strong>FluentHour Companion</strong>.</li>
              <li>Paste into Companion.</li>
              <li>Follow the phase guidance step by step.</li>
            </ol>
          </div>
          <div class="fh-phase-help__note">
            Companion behavior (explainer only): it runs bilingual, step-by-step coaching from what you paste; detects learner/helper/twist cues; keeps turns short; and supports quick commands like <em>next step</em>, <em>repeat</em>, <em>slower</em>, <em>harder</em>, <em>twist</em>, and <em>drill mode</em>.
          </div>
        </div>
      </div>
    `.trim();

    document.body.appendChild(backdrop);

    const closeBtn = backdrop.querySelector('.fh-phase-help__close');
    if (closeBtn) closeBtn.focus({ preventScroll: true });

    function close() {
      document.removeEventListener('keydown', onKey);
      backdrop.remove();
    }

    function onKey(e) {
      if (e.key === 'Escape') close();
    }

    document.addEventListener('keydown', onKey);

    backdrop.addEventListener('click', (e) => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      if (target === backdrop) close();
      if (target.matches('[data-action="close-help"]')) close();
    });
  }

  async function handleAction(action) {
    const card = findPhaseCard();
    if (!card) return;

    const text = extractPhaseText(card);
    if (!text) {
      showToast(card, 'Nothing to copy');
      return;
    }

    if (action === 'copy-phase') {
      const ok = await copyToClipboard(text);
      showToast(card, ok ? 'Copied' : 'Copy failed');
      return;
    }

    if (action === 'open-companion') {
      const ok = await copyToClipboard(text);
      let opened = null;
      try {
        opened = window.open(COMPANION_URL, '_blank', 'noopener,noreferrer');
      } catch (_) {}
      if (ok && opened) showToast(card, 'Copied — paste into Companion');
      else if (ok && !opened) showToast(card, 'Copied — popup blocked (tap again)');
      else showToast(card, 'Copy failed');
      return;
    }

    if (action === 'help') {
      openHelp();
    }
  }

  function attachDelegatedHandlers() {
    if (attachDelegatedHandlers._done) return;
    attachDelegatedHandlers._done = true;

    document.addEventListener('click', (e) => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      const btn = t.closest('[data-action]');
      if (!btn) return;
      const action = btn.getAttribute('data-action');
      if (!action) return;
      if (action === 'close-help') return;
      if (['copy-phase', 'open-companion', 'help'].includes(action)) {
        e.preventDefault();
        e.stopPropagation();
        handleAction(action);
      }
    }, { capture: true });
  }

  function tick() {
    try {
      const card = findPhaseCard();
      if (card) ensureToolbar(card);
    } catch (_) {}
  }

  function start() {
    attachDelegatedHandlers();
    tick();

    const obs = new MutationObserver(() => tick());
    obs.observe(document.documentElement, { subtree: true, childList: true });

    window.addEventListener('hashchange', tick);
    window.addEventListener('popstate', tick);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
