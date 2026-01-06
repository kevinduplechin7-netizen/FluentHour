/*
  FluentHour Companion Bridge

  What it does:
  - Injects a small helper card into the Session screen
  - "Copy this phase" (recommended) or "Copy whole session" to clipboard
  - "Open Companion GPT" to paste into FluentHour Companion

  Notes:
  - Works on the built (dist) site: it reads the current Session title + current phase index from the DOM,
    then parses the library text (default + any user-added library text in localStorage) to build a clean payload.
*/

(() => {
  const COMPANION_GPT_URL = "https://chatgpt.com/g/g-6958040e8ce881918400c643c84bbfc1-fluenthour-companion";
  const PHASE_ACTOR_GPT_URL = "https://chatgpt.com/g/g-695ca3f3a694819187975bb509bc15cb-fluent-hour-phase-actor";
  const STORAGE_KEY = "fluenthour.profiles.v1";
  const DEFAULT_LIBRARY_PATH = "/library/perfect-hour-data.txt";
  const INJECT_ID_COMPANION = "fh-companion-bridge";
  const INJECT_ID_ACTOR = "fh-phase-actor-bridge";

  if (window.__FH_COMPANION_BRIDGE__) return;
  window.__FH_COMPANION_BRIDGE__ = true;

  // --- tiny UI helpers -----------------------------------------------------

  function toast(message) {
    const el = document.createElement("div");
    el.textContent = message;
    el.style.position = "fixed";
    el.style.left = "50%";
    el.style.bottom = "18px";
    el.style.transform = "translateX(-50%)";
    el.style.zIndex = "9999";
    el.style.padding = "10px 12px";
    el.style.borderRadius = "999px";
    el.style.border = "1px solid rgba(15, 23, 42, 0.14)";
    el.style.background = "rgba(255, 255, 255, 0.92)";
    el.style.backdropFilter = "blur(10px)";
    el.style.boxShadow = "0 18px 55px rgba(15, 23, 42, .1), 0 8px 18px rgba(15, 23, 42, .06)";
    el.style.color = "rgba(15, 23, 42, 0.88)";
    el.style.fontWeight = "700";
    el.style.fontSize = "13px";
    el.style.maxWidth = "min(92vw, 720px)";
    el.style.textAlign = "center";

    document.body.appendChild(el);
    setTimeout(() => {
      el.style.opacity = "0";
      el.style.transition = "opacity 200ms ease";
    }, 1500);
    setTimeout(() => {
      el.remove();
    }, 1900);
  }

  async function copyToClipboard(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (_) {
      // fall through
    }

    // Fallback
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.top = "-9999px";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return !!ok;
    } catch (_) {
      return false;
    }
  }

  function safeJsonParse(str) {
    if (!str) return null;
    try {
      return JSON.parse(str);
    } catch {
      return null;
    }
  }

  function normalizeNewlines(s) {
    return (s || "").replace(/\r\n/g, "\n");
  }

  // --- library parsing -----------------------------------------------------

  function parseSessionsFromText(rawText) {
    const text = normalizeNewlines(rawText);
    const sessions = [];

    // Split by blocks
    const parts = text.split("BEGIN PERFECT HOUR SESSION");
    if (parts.length <= 1) return sessions;

    for (let i = 1; i < parts.length; i++) {
      const chunk = parts[i];
      const endIdx = chunk.indexOf("END PERFECT HOUR SESSION");
      if (endIdx === -1) continue;
      const block = chunk.slice(0, endIdx);

      const lines = normalizeNewlines(block)
        .split("\n")
        .map((l) => l.replace(/\s+$/g, ""));

      const getField = (prefix) => {
        const line = lines.find((l) => l.trimStart().startsWith(prefix));
        if (!line) return "";
        return line.trimStart().slice(prefix.length).trim();
      };

      const title = getField("Title:") || "(Untitled session)";
      const levelRaw = getField("Level:") || "";
      const partner = getField("Partner:") || "";
      const goal = getField("Goal:") || "";
      const context = getField("Context:") || "";
      const correction = getField("Correction:") || "";

      const levelMatch = (levelRaw.match(/\b(A1|A2|B1|B2|C1|C2)\b/i) || [])[1];
      const levelKey = levelMatch ? levelMatch.toUpperCase() : "";

      // Phase parsing
      const phases = [];
      let current = null;
      let mode = "";

      const pushCurrent = () => {
        if (!current) return;
        // Trim arrays
        current.humanSteps = (current.humanSteps || []).filter(Boolean);
        if (current.aiScript) current.aiScript = current.aiScript.trim();
        if (current.purpose) current.purpose = current.purpose.trim();
        phases.push(current);
      };

      // State for multi-line sections
      let inHumanSteps = false;
      let inAiScript = false;

      for (let li = 0; li < lines.length; li++) {
        const rawLine = lines[li] || "";
        const line = rawLine.trim();

        // Mode line (some sessions include "Mode:")
        if (line.startsWith("Mode:")) {
          mode = line.slice("Mode:".length).trim();
          continue;
        }

        // New phase
        const phaseMatch = line.match(/^PHASE\s+(\d+)\s*:\s*(.*?)\s*(?:\((\d+)m\))?\s*$/i);
        if (phaseMatch) {
          pushCurrent();
          current = {
            index: parseInt(phaseMatch[1], 10) - 1,
            name: (phaseMatch[2] || "").trim() || `Phase ${phaseMatch[1]}`,
            minutes: phaseMatch[3] ? parseInt(phaseMatch[3], 10) : 10,
            purpose: "",
            humanSteps: [],
            aiScript: "",
          };
          inHumanSteps = false;
          inAiScript = false;
          continue;
        }

        if (!current) continue;

        // Section headers
        if (line.startsWith("Name:")) {
          current.name = line.slice("Name:".length).trim() || current.name;
          inHumanSteps = false;
          inAiScript = false;
          continue;
        }
        if (line.startsWith("Minutes:")) {
          const n = parseInt(line.slice("Minutes:".length).trim(), 10);
          if (!isNaN(n)) current.minutes = n;
          inHumanSteps = false;
          inAiScript = false;
          continue;
        }
        if (line.startsWith("Purpose:")) {
          current.purpose = line.slice("Purpose:".length).trim();
          inHumanSteps = false;
          inAiScript = false;
          continue;
        }

        if (/^Human steps\s*:/i.test(line)) {
          inHumanSteps = true;
          inAiScript = false;
          const rest = line.split(":").slice(1).join(":").trim();
          if (rest) current.humanSteps.push(rest);
          continue;
        }

        if (/^AI helper script\s*:/i.test(line)) {
          inAiScript = true;
          inHumanSteps = false;
          const rest = line.split(":").slice(1).join(":").trim();
          if (rest) current.aiScript = rest;
          continue;
        }

        // End multi-line sections when encountering other known headers
        if (/^(Twists|Notes|Helper)\s*:/i.test(line)) {
          inHumanSteps = false;
          inAiScript = false;
          continue;
        }

        // Bullet lines
        const bullet = line.match(/^\*\s+(.*)$/) || line.match(/^\-\s+(.*)$/);
        if (bullet) {
          const item = (bullet[1] || "").trim();
          if (!item) continue;
          if (inAiScript) {
            current.aiScript = (current.aiScript ? current.aiScript + "\n" : "") + item;
          } else {
            current.humanSteps.push(item);
          }
          continue;
        }

        // Plain continuation lines (rare)
        if (inAiScript && line) {
          current.aiScript = (current.aiScript ? current.aiScript + "\n" : "") + line;
          continue;
        }
      }

      pushCurrent();

      sessions.push({
        title,
        levelKey,
        partner,
        mode,
        goal,
        context,
        correction,
        phases,
      });
    }

    return sessions;
  }

  async function fetchTextSafe(url) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) return "";
      const txt = await res.text();
      // defensive: if we got HTML instead of the library file
      const t = (txt || "").trimStart();
      if (t.startsWith("<!doctype html") || t.startsWith("<!DOCTYPE html") || t.startsWith("<html")) return "";
      return txt;
    } catch {
      return "";
    }
  }

  function getUserLibraryTextFromLocalStorage() {
    const data = safeJsonParse(localStorage.getItem(STORAGE_KEY));
    if (!data || !Array.isArray(data.profiles) || !data.profiles.length) return "";
    const activeId = data.activeId;
    const profile = data.profiles.find((p) => p && p.id === activeId) || data.profiles[0];
    return (profile && typeof profile.userLibraryText === "string") ? profile.userLibraryText : "";
  }

  const libraryCache = {
    at: 0,
    sessions: null,
  };

  async function getParsedSessions() {
    const now = Date.now();
    if (libraryCache.sessions && now - libraryCache.at < 20_000) return libraryCache.sessions;

    const [defaultLib, userLib] = await Promise.all([
      fetchTextSafe(DEFAULT_LIBRARY_PATH),
      Promise.resolve(getUserLibraryTextFromLocalStorage()),
    ]);

    const combined = [defaultLib, userLib].filter(Boolean).join("\n\n");
    const sessions = parseSessionsFromText(combined);

    libraryCache.at = now;
    libraryCache.sessions = sessions;
    return sessions;
  }

  // --- DOM extraction (current session + phase) ----------------------------

  function isSessionScreen(container) {
    if (!container) return false;
    if (!container.querySelector(".fh-timer")) return false;
    const headers = Array.from(container.querySelectorAll(".fh-card-header > div"));
    return headers.some((h) => (h.textContent || "").trim() === "Learner");
  }

  function getSessionDomMeta(container) {
    const cards = Array.from(container.querySelectorAll(":scope > .fh-card"));
    if (!cards.length) return null;

    const headerCard = cards[0];
    const headerTitleEl = headerCard.querySelector(".fh-card-header > div");
    const title = (headerTitleEl?.textContent || "").trim();

    const topPills = Array.from(headerCard.querySelectorAll(".fh-card-header .fh-button-group .fh-pill"))
      .map((p) => (p.textContent || "").trim())
      .filter(Boolean);

    const levelKey = (topPills[0] || "").trim();
    const partner = (topPills[1] || "").trim();
    const profileName = (topPills[2] || "").trim();

    // Find the phase-status pill bar (the one with lots of Now/Next/Done pills)
    const groups = Array.from(headerCard.querySelectorAll(".fh-button-group"));
    let phasePills = [];
    for (const g of groups) {
      const pills = Array.from(g.querySelectorAll(".fh-pill"));
      if (pills.length < 2) continue;
      const matchCount = pills.filter((p) => /^(Now|Next|Done)\s*:\s*\d+\s*m/i.test((p.textContent || "").trim())).length;
      if (matchCount >= 2) {
        phasePills = pills;
        break;
      }
    }

    let phaseIndex = -1;
    if (phasePills.length) {
      phaseIndex = phasePills.findIndex((p) => /^(Now)\s*:/i.test((p.textContent || "").trim()));
    }

    // Learner card right-side pill is the current phase name
    const learnerHeader = cards
      .map((c) => ({ c, header: c.querySelector(".fh-card-header > div") }))
      .find((x) => (x.header?.textContent || "").trim() === "Learner");

    const currentPhaseName = (learnerHeader?.c.querySelector(".fh-card-header .fh-pill")?.textContent || "").trim();

    return {
      title,
      levelKey,
      partner,
      profileName,
      phaseIndex,
      currentPhaseName,
    };
  }

  function buildPhasePayload(session, phase, meta) {
    const lines = [];

    lines.push("FluentHour — paste into FluentHour Companion GPT");
    lines.push("");

    if (session?.title) lines.push(`Session: ${session.title}`);
    if (session?.levelKey || meta?.levelKey) lines.push(`Level: ${session.levelKey || meta.levelKey}`);
    if (meta?.partner) lines.push(`Helper mode: ${meta.partner}`);
    if (meta?.profileName) lines.push(`My language: ${meta.profileName}`);
    if (session?.goal) lines.push(`Goal: ${session.goal}`);
    if (session?.context) lines.push(`Context: ${session.context}`);
    if (session?.correction) lines.push(`Correction focus: ${session.correction}`);

    lines.push("");

    if (phase) {
      lines.push(`Current phase: ${phase.name} (${phase.minutes}m)`);
      if (phase.purpose) lines.push(`Purpose: ${phase.purpose}`);
      if (Array.isArray(phase.humanSteps) && phase.humanSteps.length) {
        lines.push("");
        lines.push("Human steps:");
        for (const s of phase.humanSteps) lines.push(`- ${s}`);
      }
      if (phase.aiScript) {
        lines.push("");
        lines.push("AI helper script:");
        lines.push(phase.aiScript);
      }
    }

    lines.push("");
    lines.push("(If needed) Companion GPT link:");
    lines.push(COMPANION_GPT_URL);

    return lines.join("\n").trim() + "\n";
  }

  function buildSessionPayload(session, meta) {
    const lines = [];
    lines.push("FluentHour — paste into FluentHour Companion GPT");
    lines.push("");

    if (session?.title) lines.push(`Session: ${session.title}`);
    if (session?.levelKey || meta?.levelKey) lines.push(`Level: ${session.levelKey || meta.levelKey}`);
    if (meta?.partner) lines.push(`Helper mode: ${meta.partner}`);
    if (meta?.profileName) lines.push(`My language: ${meta.profileName}`);
    if (session?.goal) lines.push(`Goal: ${session.goal}`);
    if (session?.context) lines.push(`Context: ${session.context}`);
    if (session?.correction) lines.push(`Correction focus: ${session.correction}`);

    lines.push("");
    lines.push("Phases:");

    for (const p of session?.phases || []) {
      lines.push("");
      lines.push(`- ${p.name} (${p.minutes}m)`);
      if (p.purpose) lines.push(`  Purpose: ${p.purpose}`);
      if (Array.isArray(p.humanSteps) && p.humanSteps.length) {
        lines.push("  Human steps:");
        for (const s of p.humanSteps) lines.push(`  - ${s}`);
      }
      if (p.aiScript) {
        lines.push("  AI helper script:");
        const aiLines = String(p.aiScript).split("\n");
        for (const al of aiLines) lines.push(`  ${al}`);
      }
    }

    lines.push("");
    lines.push("Companion GPT link:");
    lines.push(COMPANION_GPT_URL);

    return lines.join("\n").trim() + "\n";
  }

  async function resolveCurrentSessionAndPhase(meta) {
    const sessions = await getParsedSessions();

    const title = (meta?.title || "").trim();
    if (!title) return { session: null, phase: null };

    // Primary: match by title + (optional) levelKey
    let session = sessions.find((s) => (s.title || "").trim() === title);

    if (!session && meta?.levelKey) {
      session = sessions.find((s) => (s.title || "").trim() === title && (s.levelKey || "").trim() === meta.levelKey.trim());
    }

    // Secondary: fuzzy match by startsWith (handles extra whitespace)
    if (!session) {
      session = sessions.find((s) => (s.title || "").trim().toLowerCase() === title.toLowerCase());
    }

    if (!session) return { session: null, phase: null };

    let phase = null;
    const idx = meta?.phaseIndex;
    if (typeof idx === "number" && idx >= 0 && idx < session.phases.length) {
      phase = session.phases[idx];
    } else if (meta?.currentPhaseName) {
      const name = meta.currentPhaseName.trim();
      phase = session.phases.find((p) => (p.name || "").trim() === name) || null;
    }

    return { session, phase };
  }

  // --- injection -----------------------------------------------------------

  function createBridgeCard() {
    const card = document.createElement("div");
    card.id = INJECT_ID_COMPANION;
    card.className = "fh-card fh-card--subtle";

    card.innerHTML = `
      <div class="fh-card-header">
        <div style="font-weight: 900; letter-spacing: -0.01em;">Send to FluentHour Companion</div>
        <div class="fh-button-group" style="justify-content:flex-end;">
          <a class="fh-menu-button" href="${COMPANION_GPT_URL}" target="_blank" rel="noreferrer noopener">Open Companion GPT</a>
        </div>
      </div>

      <div class="fh-text-muted" style="margin-bottom: 10px;">
        Copy the current phase (or the whole session), open the Companion GPT, paste, and press Enter.
      </div>

      <div class="fh-button-group" style="margin-bottom: 8px;">
        <button class="fh-menu-button" type="button" data-action="copy-phase">Copy this phase</button>
        <button class="fh-menu-button" type="button" data-action="copy-session">Copy whole session</button>
        <button class="fh-menu-button" type="button" data-action="copy-open">Copy + Open</button>
      </div>

      <div class="fh-text-muted">
        Tip: if you want the AI helper script visible on-screen, pause first (then open <b>Advanced</b> → <b>Helper</b>). Copying still includes the script when it exists in the library.
      </div>
    `.trim();

    return card;
  }


  // --- Phase Actor (additional destination) --------------------------------

  function looksUnsetLanguage(name) {
    const s = String(name || "").trim().toLowerCase();
    return !s || s === "my language" || s === "my language (default)" || s === "default";
  }

  function numberToWordsEn(n) {
    const num = Math.floor(Number(n));
    if (!isFinite(num) || num < 0) return "";
    const ones = ["zero","one","two","three","four","five","six","seven","eight","nine","ten","eleven","twelve","thirteen","fourteen","fifteen","sixteen","seventeen","eighteen","nineteen"];
    const tens = ["","","twenty","thirty","forty","fifty","sixty","seventy","eighty","ninety"];

    function underHundred(x) {
      if (x < 20) return ones[x];
      const t = Math.floor(x / 10);
      const r = x % 10;
      return r ? `${tens[t]}-${ones[r]}` : tens[t];
    }

    function underThousand(x) {
      if (x < 100) return underHundred(x);
      const h = Math.floor(x / 100);
      const r = x % 100;
      if (!r) return `${ones[h]} hundred`;
      return `${ones[h]} hundred ${underHundred(r)}`;
    }

    if (num < 1000) return underThousand(num);

    const th = Math.floor(num / 1000);
    const r = num % 1000;
    if (!r) return `${underThousand(th)} thousand`;
    return `${underThousand(th)} thousand ${underThousand(r)}`;
  }

  function minutesToWordsEn(minutes) {
    const w = numberToWordsEn(minutes);
    return w ? `${w} minutes` : "minutes";
  }

  function buildActorPhasePrompt(session, phase, meta) {
    const lines = [];

    const targetLanguage = looksUnsetLanguage(meta?.profileName) ? "" : String(meta?.profileName || "").trim();

    lines.push("Fluent Hour — paste into Fluent Hour Phase Actor");
    lines.push("");
    lines.push("ROLE");
    lines.push("- You are the helper. Run this phase as a live conversation.");
    lines.push("- Speak only in the target language.");
    lines.push("- If the target language is unclear, ask me which target language to use, then wait.");
    lines.push("- Keep learner speech level-appropriate but natural and correct.");
    lines.push("- Helper speech must be native, correct, and clear (not slangy).");
    lines.push("- Do not use digits; write all numbers out as words in the target language.");
    lines.push("");
    lines.push("TARGET LANGUAGE");
    lines.push(targetLanguage || "(not set — ask me which target language)");
    lines.push("");
    if (session?.title) lines.push(`Session: ${session.title}`);
    if (session?.levelKey || meta?.levelKey) lines.push(`Level: ${session.levelKey || meta.levelKey}`);
    if (meta?.partner) lines.push(`Helper mode: ${meta.partner}`);
    if (session?.goal) lines.push(`Goal: ${session.goal}`);
    if (session?.context) lines.push(`Context: ${session.context}`);
    if (session?.correction) lines.push(`Correction focus: ${session.correction}`);
    lines.push("");

    if (phase) {
      lines.push("PHASE TO RUN");
      lines.push(`Name: ${phase.name}`);
      lines.push(`Duration: ${minutesToWordsEn(phase.minutes)}`);
      if (phase.purpose) lines.push(`Purpose: ${phase.purpose}`);
      if (Array.isArray(phase.humanSteps) && phase.humanSteps.length) {
        lines.push("");
        lines.push("Human steps:");
        for (const s of phase.humanSteps) lines.push(`- ${s}`);
      }
      if (phase.aiScript) {
        lines.push("");
        lines.push("AI helper script:");
        lines.push(phase.aiScript);
      }
    }

    lines.push("");
    lines.push("Phase Actor GPT link:");
    lines.push(PHASE_ACTOR_GPT_URL);

    return lines.join("\n").trim() + "\n";
  }

  function buildActorSessionPrompt(session, meta) {
    const lines = [];
    const targetLanguage = looksUnsetLanguage(meta?.profileName) ? "" : String(meta?.profileName || "").trim();

    lines.push("Fluent Hour — paste into Fluent Hour Phase Actor");
    lines.push("");
    lines.push("ROLE");
    lines.push("- You are the helper. Run the session phase-by-phase as a live conversation.");
    lines.push("- Speak only in the target language.");
    lines.push("- If the target language is unclear, ask me which target language to use, then wait.");
    lines.push("- Keep learner speech level-appropriate but natural and correct.");
    lines.push("- Helper speech must be native, correct, and clear (not slangy).");
    lines.push("- Do not use digits; write all numbers out as words in the target language.");
    lines.push("");
    lines.push("TARGET LANGUAGE");
    lines.push(targetLanguage || "(not set — ask me which target language)");
    lines.push("");
    if (session?.title) lines.push(`Session: ${session.title}`);
    if (session?.levelKey || meta?.levelKey) lines.push(`Level: ${session.levelKey || meta.levelKey}`);
    if (meta?.partner) lines.push(`Helper mode: ${meta.partner}`);
    if (session?.goal) lines.push(`Goal: ${session.goal}`);
    if (session?.context) lines.push(`Context: ${session.context}`);
    if (session?.correction) lines.push(`Correction focus: ${session.correction}`);

    lines.push("");
    lines.push("PHASES TO RUN:");

    for (const p of session?.phases || []) {
      lines.push("");
      lines.push(`- Name: ${p.name}`);
      lines.push(`  Duration: ${minutesToWordsEn(p.minutes)}`);
      if (p.purpose) lines.push(`  Purpose: ${p.purpose}`);
      if (Array.isArray(p.humanSteps) && p.humanSteps.length) {
        lines.push("  Human steps:");
        for (const s of p.humanSteps) lines.push(`  - ${s}`);
      }
      if (p.aiScript) {
        lines.push("  AI helper script:");
        const aiLines = String(p.aiScript).split("\n");
        for (const al of aiLines) lines.push(`  ${al}`);
      }
    }

    lines.push("");
    lines.push("Phase Actor GPT link:");
    lines.push(PHASE_ACTOR_GPT_URL);

    return lines.join("\n").trim() + "\n";
  }

  function createActorBridgeCard() {
    const card = document.createElement("div");
    card.id = INJECT_ID_ACTOR;
    card.className = "fh-card fh-card--subtle";

    card.innerHTML = `
      <div class="fh-card-header">
        <div style="font-weight: 900; letter-spacing: -0.01em;">Send to Fluent Hour Phase Actor</div>
        <div class="fh-button-group" style="justify-content:flex-end;">
          <a class="fh-menu-button" href="${PHASE_ACTOR_GPT_URL}" target="_blank" rel="noreferrer noopener">Open Phase Actor GPT</a>
        </div>
      </div>

      <div class="fh-text-muted" style="margin-bottom: 10px;">
        Copy the current phase (or the whole session), open Phase Actor, paste, and press Enter.
      </div>

      <div class="fh-button-group" style="margin-bottom: 8px;">
        <button class="fh-menu-button" type="button" data-action="actor-copy-phase">Copy this phase</button>
        <button class="fh-menu-button" type="button" data-action="actor-copy-session">Copy whole session</button>
        <button class="fh-menu-button" type="button" data-action="actor-copy-open">Copy + Open</button>
      </div>

      <div class="fh-text-muted">
        Tip: if you want the AI helper script visible on-screen, pause first (then open <b>Advanced</b> → <b>Helper</b>). Copying still includes the script when it exists in the library.
      </div>
    `.trim();

    return card;
  }

  async function handleActorAction(action, container, btn) {
    const meta = getSessionDomMeta(container);

    if (!meta || !meta.title) {
      toast("Couldn’t detect the current session. Open a session first.");
      return;
    }

    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Working…";

    try {
      const { session, phase } = await resolveCurrentSessionAndPhase(meta);

      if (!session) {
        const learnerCard = Array.from(container.querySelectorAll(":scope > .fh-card"))
          .find((c) => (c.querySelector(".fh-card-header > div")?.textContent || "").trim() === "Learner");

        const visible = learnerCard ? learnerCard.innerText : container.innerText;
        const payload = `Fluent Hour — paste into Fluent Hour Phase Actor\n\n${visible}\n\n${PHASE_ACTOR_GPT_URL}\n`;

        const ok = await copyToClipboard(payload);
        toast(ok ? "Copied (visible text)." : "Copy failed — select text and press Ctrl+C.");

        if (action === "actor-copy-open") {
          window.open(PHASE_ACTOR_GPT_URL, "_blank", "noopener,noreferrer");
        }
        return;
      }

      let payload = "";
      if (action === "actor-copy-session") {
        payload = buildActorSessionPrompt(session, meta);
      } else {
        payload = buildActorPhasePrompt(session, phase, meta);
      }

      const ok = await copyToClipboard(payload);
      toast(ok ? "Copied to clipboard." : "Copy failed — try again (or press Ctrl+C).");

      if (action === "actor-copy-open") {
        window.open(PHASE_ACTOR_GPT_URL, "_blank", "noopener,noreferrer");
      }
    } catch (err) {
      toast("Something went wrong while preparing the copy text.");
      // eslint-disable-next-line no-console
      console.error("FH Phase Actor Bridge error:", err);
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
  }


  async function handleAction(action, container, btn) {
    const meta = getSessionDomMeta(container);

    if (!meta || !meta.title) {
      toast("Couldn’t detect the current session. Open a session first.");
      return;
    }

    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Working…";

    try {
      const { session, phase } = await resolveCurrentSessionAndPhase(meta);

      if (!session) {
        // Fallback: copy visible Learner card text
        const learnerCard = Array.from(container.querySelectorAll(":scope > .fh-card"))
          .find((c) => (c.querySelector(".fh-card-header > div")?.textContent || "").trim() === "Learner");

        const visible = learnerCard ? learnerCard.innerText : container.innerText;
        const payload = `FluentHour — paste into FluentHour Companion GPT\n\n${visible}\n\n${COMPANION_GPT_URL}\n`;

        const ok = await copyToClipboard(payload);
        toast(ok ? "Copied (visible text)." : "Copy failed — select text and press Ctrl+C.");

        if (action === "copy-open") {
          window.open(COMPANION_GPT_URL, "_blank", "noopener,noreferrer");
        }
        return;
      }

      let payload = "";
      if (action === "copy-session") {
        payload = buildSessionPayload(session, meta);
      } else {
        payload = buildPhasePayload(session, phase, meta);
      }

      const ok = await copyToClipboard(payload);
      toast(ok ? "Copied to clipboard." : "Copy failed — try again (or press Ctrl+C)." );

      if (action === "copy-open") {
        window.open(COMPANION_GPT_URL, "_blank", "noopener,noreferrer");
      }
    } catch (err) {
      toast("Something went wrong while preparing the copy text.");
      // eslint-disable-next-line no-console
      console.error("FH Companion Bridge error:", err);
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
  }

    function ensureInjected() {
    const container = document.querySelector(".fh-container");
    if (!isSessionScreen(container)) {
      const existingCompanion = document.getElementById(INJECT_ID_COMPANION);
      if (existingCompanion) existingCompanion.remove();
      const existingActor = document.getElementById(INJECT_ID_ACTOR);
      if (existingActor) existingActor.remove();
      return;
    }

    const hasCompanion = !!document.getElementById(INJECT_ID_COMPANION);
    const hasActor = !!document.getElementById(INJECT_ID_ACTOR);
    if (hasCompanion && hasActor) return;

    // Insert right after the top session header card
    const cards = Array.from(container.querySelectorAll(":scope > .fh-card"));
    if (!cards.length) return;

    const headerCard = cards[0];
    let anchor = headerCard;

    if (!hasCompanion) {
      const bridge = createBridgeCard();
      anchor.insertAdjacentElement("afterend", bridge);
      anchor = bridge;

      bridge.addEventListener("click", (e) => {
        const target = e.target;
        if (!(target instanceof HTMLElement)) return;
        const btn = target.closest("button[data-action]");
        if (!(btn instanceof HTMLButtonElement)) return;
        const action = btn.getAttribute("data-action");
        if (!action) return;
        handleAction(action, container, btn);
      });
    } else {
      anchor = document.getElementById(INJECT_ID_COMPANION) || headerCard;
    }

    if (!hasActor) {
      const actorBridge = createActorBridgeCard();
      anchor.insertAdjacentElement("afterend", actorBridge);

      actorBridge.addEventListener("click", (e) => {
        const target = e.target;
        if (!(target instanceof HTMLElement)) return;
        const btn = target.closest("button[data-action]");
        if (!(btn instanceof HTMLButtonElement)) return;
        const action = btn.getAttribute("data-action");
        if (!action) return;
        handleActorAction(action, container, btn);
      });
    }
  }

  // Watch for client-side navigation / rerenders
  const mo = new MutationObserver(() => {
    // Slight debounce
    if (ensureInjected._t) cancelAnimationFrame(ensureInjected._t);
    ensureInjected._t = requestAnimationFrame(ensureInjected);
  });

  mo.observe(document.documentElement, { childList: true, subtree: true });

  // Initial
  ensureInjected();
})();
