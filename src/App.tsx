import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * FluentHour — premium, local-first, two-screen app.
 *
 * HOME
 *  - One primary action: Start my fluent hour (Path by default)
 *  - Level + Mode are dropdown buttons
 *  - Multi-language profiles (one set of progress per language)
 *  - Hours goal + completion tracking
 *  - Checklist sheet: click a session to start; checkbox to toggle completion
 *  - Backup export/import + weekly reminder (advanced)
 *
 * SESSION (Runner)
 *  - Timer card (Start/Pause, autopause at phase end, Skip to next counts as done)
 *  - Learner card (situation summary + steps + purpose)
 *  - Helper card hidden while running; shows only when paused (Advanced)
 *  - Localize card (collapsed by default)
 */

const APP_NAME = "FluentHour";
const APP_SUBTITLE = "Guided speaking practice • CLB / ACTFL / CEFR‑informed";
const APP_TAGLINE =
  "Guided speaking practice informed by Canadian Language Benchmarks (CLB), ACTFL, and CEFR. Set your goal hours, start at your level, and follow the steps with a language helper.";


type Screen = "HOME" | "SESSION";

type LevelKey = "A1" | "A2" | "B1" | "B2" | "C1" | "C2";
const LEVELS: { key: LevelKey; label: string }[] = [
  { key: "A1", label: "A1" },
  { key: "A2", label: "A2" },
  { key: "B1", label: "B1" },
  { key: "B2", label: "B2" },
  { key: "C1", label: "C1" },
  { key: "C2", label: "C2" },
];

type Mode = "path" | "random"; // path is default
type PartnerMode = "human" | "ai";

type FocusCategory =
  | "General"
  | "Travel & transit"
  | "Food & ordering"
  | "Housing & errands"
  | "Work & professional"
  | "Social & relationships"
  | "Health & emergencies"
  | "Culture & politeness"
  | "Problem solving & repair"
  | "Paperwork & admin"
  | "Family & kids"
  | "Spiritual & ministry";

const FOCUS_CATEGORIES: FocusCategory[] = [
  "General",
  "Travel & transit",
  "Food & ordering",
  "Housing & errands",
  "Work & professional",
  "Social & relationships",
  "Health & emergencies",
  "Culture & politeness",
  "Problem solving & repair",
  "Paperwork & admin",
  "Family & kids",
  "Spiritual & ministry",
];

type Phase = {
  name: string;
  minutes: number;
  purpose?: string;
  humanSteps: string[];
  aiScript?: string;
};

type Session = {
  id: string;
  title: string;
  levelKey: LevelKey;
  levelRaw?: string;
  partner?: string;
  goal?: string;
  context?: string;
  correction?: string;
  twists: string[];
  phases: Phase[];
  category?: FocusCategory;
  _raw?: string;
};

type TimeState = {
  totalMs: number;
  goalHours: number;
};

type ProgressState = {
  level: LevelKey;
  mode: Mode;
  partner: PartnerMode;
  focusCategory: FocusCategory;
  recentIdsByLevel: Record<LevelKey, string[]>;
  completedIdsByLevel: Record<LevelKey, Record<string, true>>;
  time: TimeState;
  lastBackupAtMs?: number;
  nextBackupAtMs?: number;
};

type Profile = {
  id: string;
  name: string; // e.g., "French", "Arabic", "Greek"
  progress: ProgressState;
  userLibraryText?: string; // optional imported sessions (BEGIN/END blocks)
};

type ProfilesStore = {
  activeId: string;
  profiles: Profile[];
};

const LS_KEY = "fluenthour.profiles.v1";

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function safeJsonParse<T>(s: string | null): T | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

function nowMs() {
  return Date.now();
}

function formatHrs(ms: number) {
  const hours = ms / 3600000;
  const rounded = Math.max(0, Math.round(hours * 10) / 10);
  return rounded;
}

function percent(n: number, d: number) {
  if (d <= 0) return 0;
  return Math.round((n / d) * 100);
}

function makeEmptyRecent(): Record<LevelKey, string[]> {
  return { A1: [], A2: [], B1: [], B2: [], C1: [], C2: [] };
}

function makeEmptyCompleted(): Record<LevelKey, Record<string, true>> {
  return { A1: {}, A2: {}, B1: {}, B2: {}, C1: {}, C2: {} };
}

function makeDefaultProgress(): ProgressState {
  return {
    level: "A2",
    mode: "path",
    partner: "human",
    focusCategory: "General",
    recentIdsByLevel: makeEmptyRecent(),
    completedIdsByLevel: makeEmptyCompleted(),
    time: { totalMs: 0, goalHours: 300 },
    lastBackupAtMs: undefined,
    nextBackupAtMs: undefined,
  };
}

function makeDefaultStore(): ProfilesStore {
  const p: Profile = {
    id: "p_default",
    name: "My language",
    progress: makeDefaultProgress(),
    userLibraryText: "",
  };
  return { activeId: p.id, profiles: [p] };
}

function loadStore(): ProfilesStore {
  const parsed = safeJsonParse<ProfilesStore>(localStorage.getItem(LS_KEY));
  if (!parsed || !parsed.profiles?.length) return makeDefaultStore();
  const defProgress = makeDefaultProgress();

  const profiles = parsed.profiles.map((p) => ({
    ...p,
    name: p.name || "My language",
    progress: {
      ...defProgress,
      ...(p.progress || {}),
      recentIdsByLevel: { ...makeEmptyRecent(), ...((p.progress as any)?.recentIdsByLevel || {}) },
      completedIdsByLevel: { ...makeEmptyCompleted(), ...((p.progress as any)?.completedIdsByLevel || {}) },
      time: { ...defProgress.time, ...((p.progress as any)?.time || {}) },
    },
    userLibraryText: p.userLibraryText || "",
  }));
  const activeId = profiles.some((p) => p.id === parsed.activeId) ? parsed.activeId : profiles[0].id;
  return { activeId, profiles };
}

function saveStore(store: ProfilesStore) {
  localStorage.setItem(LS_KEY, JSON.stringify(store));
}

/** Robust fetch: SPA fallback may serve index.html for missing assets. Detect HTML and reject. */
async function fetchLibraryText(url: string): Promise<string> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Library fetch failed: ${res.status}`);
  const text = await res.text();
  const trimmed = text.trimStart();
  if (trimmed.startsWith("<!doctype html") || trimmed.startsWith("<!DOCTYPE html") || trimmed.startsWith("<html")) {
    throw new Error("Library fetch returned HTML (check public/library/perfect-hour-data.txt)");
  }
  return text;
}

/** Extract valid BEGIN/END blocks; ignore everything else */
function extractBlocks(text: string): string[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: string[] = [];
  let collecting = false;
  let buf: string[] = [];
  for (const line of lines) {
    if (line.trim() === "BEGIN PERFECT HOUR SESSION") {
      collecting = true;
      buf = ["BEGIN PERFECT HOUR SESSION"];
      continue;
    }
    if (line.trim() === "END PERFECT HOUR SESSION") {
      if (collecting) {
        buf.push("END PERFECT HOUR SESSION");
        blocks.push(buf.join("\n"));
      }
      collecting = false;
      buf = [];
      continue;
    }
    if (collecting) buf.push(line);
  }
  return blocks;
}

function parseLevelKey(levelRaw: string | undefined): LevelKey | null {
  if (!levelRaw) return null;
  const m = levelRaw.trim().match(/\b([ABC][12])\b/i);
  if (!m) return null;
  const key = m[1].toUpperCase() as LevelKey;
  return (["A1", "A2", "B1", "B2", "C1", "C2"] as const).includes(key) ? key : null;
}

function stableIdFrom(title: string, levelKey: LevelKey) {
  const base = `${levelKey}::${title}`.toLowerCase().trim();
  let h = 2166136261;
  for (let i = 0; i < base.length; i++) {
    h ^= base.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `${levelKey}_${(h >>> 0).toString(16)}`;
}

function parseSessionBlock(block: string): Session | null {
  const lines = block.replace(/\r\n/g, "\n").split("\n");

  const getField = (prefix: string) => {
    const line = lines.find((l) => l.startsWith(prefix));
    if (!line) return undefined;
    return line.slice(prefix.length).trim();
  };

  const idRaw = getField("ID:");
  const title = getField("Title:") || "Untitled session";
  const levelRaw = getField("Level:");
  const levelKey = parseLevelKey(levelRaw) || "A2";

  const twists: string[] = [];
  const twistsStart = lines.findIndex((l) => l.trim() === "Twists:");
  if (twistsStart >= 0) {
    for (let i = twistsStart + 1; i < lines.length; i++) {
      const l = lines[i].trim();
      if (!l) continue;
      if (l.startsWith("END PERFECT HOUR SESSION")) break;
      if (l.startsWith("*")) twists.push(l.replace(/^\*\s*/, "").trim());
      else if (l.startsWith("-")) twists.push(l.replace(/^\-\s*/, "").trim());
      else twists.push(l);
    }
  }

  const inferPurpose = (name: string, idx: number) => {
    const n = (name || "").toLowerCase();
    if (n.includes("fluency")) return "Automate the key phrases with fast repetition.";
    if (n.includes("model") || n.includes("input")) return "Hear a clean model, notice one feature, then repeat.";
    if (n.includes("simulation") || n.includes("output")) return "Perform the interaction with short turns and gentle recasts.";
    if (n.includes("record")) return "Record a short version, listen, and fix one thing.";
    // fallback by phase index
    if (idx === 0) return "Automate the key phrases with fast repetition.";
    if (idx === 1) return "Hear a clean model, notice one feature, then repeat.";
    if (idx === 2) return "Perform the interaction with short turns and gentle recasts.";
    if (idx === 3) return "Record a short version, listen, and fix one thing.";
    return undefined;
  };

  const parsePhaseHeader = (line: string) => {
    // Supports:
    // - "PHASE 1"
    // - "PHASE 1: Fluency loop (10m)"
    // - "PHASE 2: Model and input (20 minutes)"
    const m = line.match(/^PHASE\s+(\d+)\s*(?::\s*(.+))?$/i);
    const rest = (m?.[2] || "").trim();

    let name = "";
    let minutes = 0;

    if (rest) {
      const mm = rest.match(/\((\d+)\s*(?:m|min|mins|minute|minutes)\)/i);
      if (mm?.[1]) {
        const n = parseInt(mm[1], 10);
        minutes = Number.isFinite(n) ? n : 0;
      }
      name = rest.replace(/\([^)]*\)/g, "").trim();
    }

    return { name, minutes };
  };

  const phases: Phase[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();
    if (!/^PHASE\s+\d+/i.test(line)) {
      i++;
      continue;
    }

    const header = parsePhaseHeader(line);

    let name = header.name;
    let minutes = header.minutes;
    let purpose = "";
    const humanSteps: string[] = [];
    let aiScript = "";

    let j = i + 1;
    let capturingAi = false;

    const stopHere = (t: string) => {
      return /^PHASE\s+\d+/i.test(t) || t === "END PERFECT HOUR SESSION" || t === "Twists:";
    };

    for (; j < lines.length; j++) {
      const t = lines[j].trim();
      if (!t) continue;
      if (stopHere(t)) break;

      // Structured format
      if (t.startsWith("Name:")) {
        name = t.slice("Name:".length).trim();
        continue;
      }
      if (t.startsWith("Minutes:")) {
        const n = parseInt(t.slice("Minutes:".length).trim(), 10);
        minutes = Number.isFinite(n) ? n : minutes;
        continue;
      }
      if (t.startsWith("Purpose:")) {
        purpose = t.slice("Purpose:".length).trim();
        continue;
      }

      // Human steps block (structured)
      if (t === "Human steps:" || t === "Human steps") {
        for (j = j + 1; j < lines.length; j++) {
          const bl = lines[j].trim();
          if (!bl) continue;
          if (stopHere(bl) || bl.toLowerCase().startsWith("ai helper script")) {
            j--; // let outer loop process the boundary/script line
            break;
          }
          if (bl.startsWith("*")) humanSteps.push(bl.replace(/^\*\s*/, "").trim());
          else if (bl.startsWith("-")) humanSteps.push(bl.replace(/^\-\s*/, "").trim());
          else humanSteps.push(bl);
        }
        continue;
      }

      // AI helper script (both formats)
      if (t.toLowerCase().startsWith("ai helper script:") || t.toLowerCase() === "ai helper script") {
        capturingAi = true;
        aiScript = t.includes(":") ? t.slice(t.indexOf(":") + 1).trim() : "";
        continue;
      }

      // Continuation lines for AI script
      if (capturingAi) {
        // If a new field begins, stop capturing and re-process this line.
        if (
          t.startsWith("Name:") ||
          t.startsWith("Minutes:") ||
          t.startsWith("Purpose:") ||
          t === "Human steps:" ||
          t === "Human steps"
        ) {
          capturingAi = false;
          j--;
          continue;
        }
        aiScript += (aiScript ? " " : "") + t;
        continue;
      }

      // Simple format: bullets directly under PHASE header are human steps
      if (t.startsWith("*")) humanSteps.push(t.replace(/^\*\s*/, "").trim());
      else if (t.startsWith("-")) humanSteps.push(t.replace(/^\-\s*/, "").trim());
      else {
        // non-bullet non-empty lines inside a phase are still actionable in this format
        humanSteps.push(t);
      }
    }

    const idx = phases.length;
    phases.push({
      name: name || `Phase ${idx + 1}`,
      minutes: minutes && minutes > 0 ? minutes : inferPhaseMinutes(name, idx),
      purpose: (purpose || inferPurpose(name, idx)) || undefined,
      humanSteps,
      aiScript: aiScript || undefined,
    });

    i = j;
  }

  return {
    id: (idRaw && idRaw.trim()) || stableIdFrom(title, levelKey),
    title,
    levelKey,
    levelRaw,
    partner: getField("Partner:"),
    goal: getField("Goal (CLB):") || getField("Goal:"),
    context: getField("Context:"),
    correction: getField("Correction:"),
    twists,
    phases: phases.length ? phases : [{ name: "Session", minutes: 60, purpose: "Practice", humanSteps: [] }],
    _raw: block,
  };
}

function sortSessionsForPath(list: Session[]) {
  return [...list].sort((a, b) => a.title.localeCompare(b.title));
}

function pickRandomWithVariety(list: Session[], recent: string[], maxRecent = 6) {
  if (!list.length) return null;
  const recentSet = new Set(recent.slice(-maxRecent));
  const candidates = list.filter((s) => !recentSet.has(s.id));
  const pool = candidates.length ? candidates : list;
  return pool[Math.floor(Math.random() * pool.length)];
}

function inferPhaseMinutes(name: string, idx: number) {
  const n = (name || "").toLowerCase();
  if (n.includes("fluency")) return 10;
  if (n.includes("model")) return 25;
  if (n.includes("input")) return 25;
  if (n.includes("simulation") || n.includes("output")) return 15;
  if (n.includes("record")) return 10;
  // fallback by phase index
  if (idx === 0) return 10;
  if (idx === 1) return 25;
  if (idx === 2) return 15;
  if (idx === 3) return 10;
  return 15;
}

function msInDays(days: number) {
  return days * 24 * 60 * 60 * 1000;
}

function Card(props: { title?: string; children: React.ReactNode; right?: React.ReactNode; subtle?: boolean; style?: React.CSSProperties }) {
  const { title, children, right, subtle, style } = props;
  return (
    <div
      style={{
        background: subtle ? "rgba(255,255,255,0.72)" : "var(--card)",
        border: `1px solid ${subtle ? "var(--border)" : "var(--border-strong)"}`,
        borderRadius: "var(--radius)",
        boxShadow: "var(--shadow-sm)",
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        padding: 14,
        ...style,
      }}
    >
      {(title || right) && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 10 }}>
          {title ? <div style={{ fontWeight: 700, letterSpacing: "-0.01em" }}>{title}</div> : <div />}
          {right}
        </div>
      )}
      {children}
    </div>
  );
}

function PrimaryButton(props: React.ButtonHTMLAttributes<HTMLButtonElement> & { children: React.ReactNode }) {
  const { children, style, ...rest } = props;
  return (
    <button
      {...rest}
      style={{
        width: "100%",
        padding: "14px 16px",
        borderRadius: "var(--radius)",
        border: "1px solid rgba(37,99,235,0.22)",
        background: "linear-gradient(180deg, rgba(37,99,235,0.14), rgba(37,99,235,0.08))",
        boxShadow: "var(--shadow)",
        color: "var(--text)",
        fontWeight: 800,
        letterSpacing: "-0.01em",
        ...style,
      }}
    >
      {children}
    </button>
  );
}

function SoftButton(props: React.ButtonHTMLAttributes<HTMLButtonElement> & { children: React.ReactNode }) {
  const { children, style, ...rest } = props;
  return (
    <button
      {...rest}
      style={{
        padding: "10px 12px",
        borderRadius: 999,
        border: "1px solid var(--border-strong)",
        background: "rgba(255,255,255,0.76)",
        boxShadow: "var(--shadow-sm)",
        color: "var(--text)",
        fontWeight: 700,
        ...style,
      }}
    >
      {children}
    </button>
  );
}

function SmallButton(props: React.ButtonHTMLAttributes<HTMLButtonElement> & { children: React.ReactNode; tone?: "primary" | "neutral" }) {
  const { children, tone = "neutral", style, ...rest } = props;
  const primary = tone === "primary";
  return (
    <button
      {...rest}
      style={{
        padding: "8px 10px",
        borderRadius: 999,
        border: primary ? "1px solid rgba(37,99,235,0.28)" : "1px solid rgba(15,23,42,0.12)",
        background: primary ? "rgba(37,99,235,0.10)" : "rgba(255,255,255,0.74)",
        boxShadow: "var(--shadow-sm)",
        color: "var(--text)",
        fontWeight: 800,
        fontSize: 13,
        ...style,
      }}
    >
      {children}
    </button>
  );
}

function Pill(props: { children: React.ReactNode }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 10px",
        borderRadius: 999,
        border: "1px solid var(--border)",
        background: "rgba(255,255,255,0.75)",
        fontWeight: 650,
        color: "rgba(15,23,42,0.75)",
        fontSize: 12,
      }}
    >
      {props.children}
    </span>
  );
}

function Toast(props: { message: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        left: "50%",
        bottom: 18,
        transform: "translateX(-50%)",
        maxWidth: "min(560px, calc(100vw - 28px))",
        padding: "10px 12px",
        borderRadius: 12,
        border: "1px solid rgba(15,23,42,0.12)",
        background: "rgba(255,255,255,0.92)",
        boxShadow: "var(--shadow)",
        color: "var(--text)",
        fontWeight: 650,
        fontSize: 13,
        zIndex: 50,
        backdropFilter: "blur(8px)",
      }}
    >
      {props.message}
    </div>
  );
}

/** Small, robust Error Boundary */
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean; message?: string }> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError(err: any) {
    return { hasError: true, message: String(err?.message || err) };
  }
  componentDidCatch() {}
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ maxWidth: 980, margin: "28px auto", padding: 16 }}>
          <Card title="Something went wrong">
            <div style={{ color: "var(--muted)", marginBottom: 10 }}>
              Try refreshing. If this keeps happening, your library file may be malformed.
            </div>
            <div style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace", fontSize: 12, whiteSpace: "pre-wrap" }}>
              {this.state.message}
            </div>
          </Card>
        </div>
      );
    }
    return this.props.children as any;
  }
}

function ModalSheet(props: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  const { open, onClose, title, children } = props;
  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,0.30)",
        display: "flex",
        justifyContent: "flex-end",
        zIndex: 50,
      }}
    >
      <div
        style={{
          width: "min(560px, 92vw)",
          height: "100%",
          background: "rgba(255,255,255,0.86)",
          borderLeft: "1px solid rgba(15,23,42,0.10)",
          backdropFilter: "blur(14px)",
          WebkitBackdropFilter: "blur(14px)",
          padding: 16,
          boxShadow: "0 30px 90px rgba(15,23,42,0.30)",
          overflow: "auto",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
          <div style={{ fontWeight: 950, letterSpacing: "-0.02em" }}>{title}</div>
          <SoftButton onClick={onClose} aria-label="Close">
            Close
          </SoftButton>
        </div>
        {children}
      </div>
    </div>
  );
}

function MenuButton(props: { label: string; value: string; onClick: () => void }) {
  return (
    <button
      onClick={props.onClick}
      style={{
        padding: "10px 12px",
        borderRadius: 999,
        border: "1px solid rgba(37,99,235,0.20)",
        background: "linear-gradient(180deg, rgba(37,99,235,0.12), rgba(255,255,255,0.62))",
        boxShadow: "var(--shadow-sm)",
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
        fontWeight: 850,
      }}
    >
      <span style={{ color: "rgba(15,23,42,0.70)", fontWeight: 900 }}>{props.label}</span>
      <span>{props.value}</span>
      <span style={{ color: "rgba(15,23,42,0.55)", marginLeft: 4 }}>▾</span>
    </button>
  );
}

function MenuList<T extends string>(props: { title: string; options: { value: T; label: string; sub?: string }[]; value: T; onPick: (v: T) => void; onClose: () => void }) {
  return (
    <ModalSheet open={true} onClose={props.onClose} title={props.title}>
      <div style={{ display: "grid", gap: 8 }}>
        {props.options.map((o) => {
          const active = o.value === props.value;
          return (
            <button
              key={o.value}
              onClick={() => props.onPick(o.value)}
              style={{
                textAlign: "left",
                padding: "12px 12px",
                borderRadius: "var(--radius2)",
                border: active ? "1px solid rgba(37,99,235,0.30)" : "1px solid var(--border)",
                background: active ? "rgba(37,99,235,0.08)" : "rgba(255,255,255,0.72)",
                boxShadow: "var(--shadow-sm)",
              }}
            >
              <div style={{ fontWeight: 900 }}>{o.label}</div>
              {o.sub && <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 2 }}>{o.sub}</div>}
            </button>
          );
        })}
      </div>
    </ModalSheet>
  );
}

function buildAIPrompt(args: { level: LevelKey; category: FocusCategory; context: string }) {
  const { level, category, context } = args;
  const contextLine = context.trim() ? `\nUser context: ${context.trim()}\n` : "\n";
  return [
    "You are generating FluentHour session content.",
    "",
    "Output EXACTLY one session in this format (no markdown, no extra commentary):",
    "",
    "BEGIN PERFECT HOUR SESSION",
    "Title: <short action title>",
    `Level: ${level} (ACTFL + CLB text optional)`,
    "Partner: Human or AI",
    "Goal (CLB): <one can-do sentence>",
    "Context: <one to two sentences>",
    "Correction: <one sentence describing common mistake + recast>",
    "",
    "PHASE 1",
    "Name: Fluency loop",
    "Minutes: 10",
    "Purpose: <one short sentence>",
    "Human steps:",
    "* <bullet>",
    "* <bullet>",
    "AI helper script: <one to three sentences>",
    "",
    "PHASE 2",
    "Name: Model and input",
    "Minutes: 25",
    "Purpose: <one short sentence>",
    "Human steps:",
    "* <bullet>",
    "* <bullet>",
    "AI helper script: <one to three sentences>",
    "",
    "PHASE 3",
    "Name: Simulation output",
    "Minutes: 15",
    "Purpose: <one short sentence>",
    "Human steps:",
    "* <bullet>",
    "* <bullet>",
    "AI helper script: <one to three sentences>",
    "",
    "PHASE 4",
    "Name: Record and focus",
    "Minutes: 10",
    "Purpose: <one short sentence>",
    "Human steps:",
    "* <bullet>",
    "* <bullet>",
    "AI helper script: <one to three sentences>",
    "",
    "Twists:",
    "* <twist>",
    "* <twist>",
    "END PERFECT HOUR SESSION",
    "",
    `Constraints: Level ${level}. Focus category: ${category}.${contextLine}`,
    "Keep it simple, human-friendly, and consistent with the template.",
  ].join("\n");
}

function downloadTextFile(filename: string, text: string) {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function computeNextSessionForLevel(list: Session[], completed: Record<string, true>) {
  if (!list.length) return null;
  const sorted = sortSessionsForPath(list);
  return sorted.find((s) => !completed[s.id]) || sorted[0];
}

function nextLevelWithContent(current: LevelKey, byLevel: Record<LevelKey, Session[]>) {
  const order: LevelKey[] = ["A1", "A2", "B1", "B2", "C1", "C2"];
  const idx = order.indexOf(current);
  for (let i = idx; i < order.length; i++) {
    if ((byLevel[order[i]] || []).length > 0) return order[i];
  }
  for (let i = 0; i < idx; i++) {
    if ((byLevel[order[i]] || []).length > 0) return order[i];
  }
  return current;
}

export default function App() {
  const [screen, setScreen] = useState<Screen>("HOME");

  const [store, setStore] = useState<ProfilesStore>(() => loadStore());
  const activeProfile = useMemo(() => store.profiles.find((p) => p.id === store.activeId) || store.profiles[0], [store]);
  const progress = activeProfile.progress;

  const [libraryText, setLibraryText] = useState<string>("");
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [loadingLibrary, setLoadingLibrary] = useState<boolean>(true);

  const [sessions, setSessions] = useState<Session[]>([]);
  const sessionsByLevel = useMemo(() => {
    const map: Record<LevelKey, Session[]> = { A1: [], A2: [], B1: [], B2: [], C1: [], C2: [] };
    for (const s of sessions) map[s.levelKey].push(s);
    return map;
  }, [sessions]);

  const [openLevelMenu, setOpenLevelMenu] = useState(false);
  const [openModeMenu, setOpenModeMenu] = useState(false);
  const [openLangMenu, setOpenLangMenu] = useState(false);

  const [levelSheet, setLevelSheet] = useState<LevelKey | null>(null);

  // Runner
  const [active, setActive] = useState<Session | null>(null);
  const [phaseIdx, setPhaseIdx] = useState<number>(0);
  const [secondsLeft, setSecondsLeft] = useState<number>(0);
  const [running, setRunning] = useState<boolean>(false);
  const [phaseDone, setPhaseDone] = useState<Record<number, true>>({});
  const [sessionEnded, setSessionEnded] = useState<boolean>(false);
  const tickRef = useRef<number | null>(null);
  const runStartedAtRef = useRef<number | null>(null);

  const [sessionLoggedMs, setSessionLoggedMs] = useState<number>(0);

  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const showToast = React.useCallback((msg: string) => {
    setToast(msg);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 2800);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    };
  }, []);

  const [showAdvanced, setShowAdvanced] = useState<boolean>(false);
  const [showImport, setShowImport] = useState<boolean>(false);
  const [showLocalize, setShowLocalize] = useState<boolean>(false);

  const [importLevel, setImportLevel] = useState<LevelKey>("A2");
  const [importCategory, setImportCategory] = useState<FocusCategory>("General");
  const [importContext, setImportContext] = useState<string>("");
  const [importPaste, setImportPaste] = useState<string>("");
  const [importMsg, setImportMsg] = useState<string>("");

  // Persist store
  useEffect(() => {
    saveStore(store);
  }, [store]);

  // Title for tab
  useEffect(() => {
    document.title = `${APP_NAME} — ${activeProfile.name}`;
  }, [activeProfile.name]);

  // Load library once
  useEffect(() => {
    let alive = true;
    (async () => {
      setLoadingLibrary(true);
      setLibraryError(null);
      try {
        const txt = await fetchLibraryText("/library/perfect-hour-data.txt");
        if (!alive) return;
        setLibraryText(txt);
      } catch (e: any) {
        if (!alive) return;
        setLibraryError(String(e?.message || e));
      } finally {
        if (alive) setLoadingLibrary(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Parse sessions when base library or profile user library changes
  useEffect(() => {
    if (!libraryText && !activeProfile.userLibraryText) return;

    const blocks = extractBlocks(libraryText || "");
    const userBlocks = extractBlocks(activeProfile.userLibraryText || "");

    const parsed: Session[] = [];
    for (const b of blocks) {
      const s = parseSessionBlock(b);
      if (s) parsed.push(s);
    }
    for (const b of userBlocks) {
      const s = parseSessionBlock(b);
      if (s) parsed.push(s);
    }

    // de-dupe by id (first wins)
    const seen = new Set<string>();
    const deduped: Session[] = [];
    for (const s of parsed) {
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      deduped.push(s);
    }
    setSessions(deduped);
  }, [libraryText, activeProfile.userLibraryText, activeProfile.id]);

  // Runner ticking (robust + counts study time while running)
  const accumulateRunTime = React.useCallback(() => {
    if (runStartedAtRef.current == null) return;
    const elapsed = nowMs() - runStartedAtRef.current;
    runStartedAtRef.current = null;
    if (elapsed <= 0) return;

    setSessionLoggedMs((ms) => ms + elapsed);

    setStore((st) => ({
      ...st,
      profiles: st.profiles.map((p) => {
        if (p.id !== st.activeId) return p;
        return { ...p, progress: { ...p.progress, time: { ...p.progress.time, totalMs: p.progress.time.totalMs + elapsed } } };
      }),
    }));
  }, []);

  useEffect(() => {
    if (!running) {
      if (tickRef.current) {
        window.clearInterval(tickRef.current);
        tickRef.current = null;
      }
      accumulateRunTime();
      return;
    }

    if (tickRef.current) {
      window.clearInterval(tickRef.current);
      tickRef.current = null;
    }
    if (runStartedAtRef.current == null) runStartedAtRef.current = nowMs();

    tickRef.current = window.setInterval(() => {
      setSecondsLeft((sec) => {
        if (sec <= 1) {
          // autopause at phase end
          window.setTimeout(() => setRunning(false), 0);
          return 0;
        }
        return sec - 1;
      });
    }, 1000);

    return () => {
      if (tickRef.current) {
        window.clearInterval(tickRef.current);
        tickRef.current = null;
      }
    };
  }, [running, accumulateRunTime]);

  const currentLevelList = sessionsByLevel[progress.level] || [];
  const completedMap = progress.completedIdsByLevel[progress.level] || {};
  const completedCount = Object.keys(completedMap).length;
  const totalCount = currentLevelList.length;

  const totalHours = formatHrs(progress.time.totalMs);
  const goalHours = Math.max(1, progress.time.goalHours);
  const totalPct = clamp(Math.round((totalHours / goalHours) * 100), 0, 100);

  const needsBackup = (() => {
    const nextAt = progress.nextBackupAtMs;
    if (!nextAt) return true;
    return nowMs() >= nextAt;
  })();

  const levelCoverage = (lvl: LevelKey) => {
    const total = (sessionsByLevel[lvl] || []).length;
    const done = Object.keys(progress.completedIdsByLevel[lvl] || {}).length;
    return { total, done, pct: percent(done, total) };
  };

  function updateProgress(mutator: (p: ProgressState) => ProgressState) {
    setStore((st) => ({
      ...st,
      profiles: st.profiles.map((p) => (p.id === st.activeId ? { ...p, progress: mutator(p.progress) } : p)),
    }));
  }

  function updateActiveProfile(mutator: (p: Profile) => Profile) {
    setStore((st) => ({
      ...st,
      profiles: st.profiles.map((p) => (p.id === st.activeId ? mutator(p) : p)),
    }));
  }

  function startSession(session: Session) {
    setActive(session);
    setScreen("SESSION");
    setPhaseIdx(0);
    setPhaseDone({});
    setSessionEnded(false);
    setSessionLoggedMs(0);
    if (tickRef.current) {
      window.clearInterval(tickRef.current);
      tickRef.current = null;
    }
    runStartedAtRef.current = null;
    const first = session.phases[0];
    setSecondsLeft((first?.minutes || 0) * 60);
    setRunning(false);
    setShowAdvanced(false);
    setShowLocalize(false);
  }

  function chooseAndStart() {
    const lvl = progress.level;
    const list = sessionsByLevel[lvl] || [];
    if (!list.length) return;

    if (progress.mode === "path") {
      const next = computeNextSessionForLevel(list, progress.completedIdsByLevel[lvl] || {});
      if (next) startSession(next);
      return;
    }

    const recent = progress.recentIdsByLevel[lvl] || [];
    const chosen = pickRandomWithVariety(list, recent, 6) || list[0];
    updateProgress((p) => {
      const prev = p.recentIdsByLevel[lvl] || [];
      const nextRecent = [...prev, chosen.id].slice(-12);
      return { ...p, recentIdsByLevel: { ...p.recentIdsByLevel, [lvl]: nextRecent } };
    });
    startSession(chosen);
  }

  function markPhaseDoneAndAdvance() {
    if (!active) return;
    setPhaseDone((m) => ({ ...m, [phaseIdx]: true }));
    const nextIdx = phaseIdx + 1;
    if (nextIdx >= active.phases.length) {
      setSessionEnded(true);
      setRunning(false);
      return;
    }
    setPhaseIdx(nextIdx);
    setSecondsLeft((active.phases[nextIdx].minutes || 0) * 60);
    setRunning(false);
  }

  function skipToNext() {
    markPhaseDoneAndAdvance(); // counts as done even if skipped
  }

  function toggleRun() {
    if (!active) return;
    if (sessionEnded) return;
    if (!secondsLeft) {
      markPhaseDoneAndAdvance();
      return;
    }
    setRunning((r) => !r);
  }

  function minsFromMs(ms: number) {
    return Math.max(0, Math.round(ms / 60000));
  }

  function sessionLoggedMsNow() {
    const pending = runStartedAtRef.current == null ? 0 : Math.max(0, nowMs() - runStartedAtRef.current);
    return sessionLoggedMs + pending;
  }

  function returnHome(toastMsg?: string) {
    // Log any in-flight running time (if present) before leaving the runner.
    accumulateRunTime();
    setRunning(false);
    setActive(null);
    setPhaseIdx(0);
    setSecondsLeft(0);
    setPhaseDone({});
    setSessionEnded(false);
    setShowAdvanced(false);
    setShowLocalize(false);
    setScreen("HOME");
    if (toastMsg) showToast(toastMsg);
  }

  function finishSession() {
    const pending = runStartedAtRef.current == null ? 0 : Math.max(0, nowMs() - runStartedAtRef.current);
    const msThis = sessionLoggedMs + pending;
    const totalAfter = formatHrs(progress.time.totalMs + pending);
    returnHome(`Saved • +${minsFromMs(msThis)} min • Total ${totalAfter}h`);
  }

  function markCompleteAndReturn() {
    const pending = runStartedAtRef.current == null ? 0 : Math.max(0, nowMs() - runStartedAtRef.current);
    const msThis = sessionLoggedMs + pending;
    const totalAfter = formatHrs(progress.time.totalMs + pending);
    markSessionComplete();
    returnHome(`Completed ✓ • +${minsFromMs(msThis)} min • Total ${totalAfter}h`);
  }


  function markSessionComplete() {
    if (!active) return;
    const lvl = active.levelKey;
    updateProgress((p) => {
      const done = { ...(p.completedIdsByLevel[lvl] || {}) };
      done[active.id] = true;
      return { ...p, completedIdsByLevel: { ...p.completedIdsByLevel, [lvl]: done } };
    });

    // If path mode, auto-advance level when current level is fully complete
    if (progress.mode === "path") {
      const after = { ...(progress.completedIdsByLevel[lvl] || {}) };
      after[active.id] = true;
      const levelTotal = (sessionsByLevel[lvl] || []).length;
      const levelDone = Object.keys(after).length;
      if (levelTotal > 0 && levelDone >= levelTotal) {
        const nextLvl = nextLevelWithContent(lvl, sessionsByLevel);
        if (nextLvl !== lvl) updateProgress((p) => ({ ...p, level: nextLvl }));
      }
    }
  }

  function toggleComplete(lvl: LevelKey, id: string) {
    updateProgress((p) => {
      const done = { ...(p.completedIdsByLevel[lvl] || {}) };
      if (done[id]) delete done[id];
      else done[id] = true;
      return { ...p, completedIdsByLevel: { ...p.completedIdsByLevel, [lvl]: done } };
    });
  }

  function doImport() {
    setImportMsg("");
    const txt = importPaste.trim();
    if (!txt) {
      setImportMsg("Paste an AI session first.");
      return;
    }
    const blocks = extractBlocks(txt);
    if (!blocks.length) {
      setImportMsg("I couldn’t find a valid BEGIN/END session block.");
      return;
    }

    // Store raw text blocks per-profile so multi-language works
    updateActiveProfile((p) => ({
      ...p,
      userLibraryText: [p.userLibraryText || "", blocks.join("\n\n")].filter(Boolean).join("\n\n"),
    }));

    setImportPaste("");
    setImportMsg(`Imported ${blocks.length} session(s) into this device.`);
  }

  function exportBackup() {
    const payload: ProfilesStore = store;
    downloadTextFile("fluenthour-backup.json", JSON.stringify(payload, null, 2));
    updateProgress((p) => {
      const t = nowMs();
      return { ...p, lastBackupAtMs: t, nextBackupAtMs: t + msInDays(7) };
    });
  }

  async function importBackupFile(file: File) {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as ProfilesStore;
      if (!parsed || !Array.isArray(parsed.profiles) || !parsed.profiles.length) throw new Error("Invalid backup file.");
      setStore(() => parsed);
    } catch (e: any) {
      alert(String(e?.message || e));
    }
  }

  function addLanguage() {
    const name = prompt("Name your language profile (example: French, Arabic, Greek):");
    if (!name) return;
    const id = `p_${Math.random().toString(16).slice(2)}`;
    const p: Profile = { id, name: name.trim(), progress: makeDefaultProgress(), userLibraryText: "" };
    setStore((st) => ({ ...st, profiles: [...st.profiles, p], activeId: id }));
  }

  function renameLanguage(id: string) {
    const current = store.profiles.find((p) => p.id === id);
    if (!current) return;
    const name = prompt("Rename language profile:", current.name);
    if (!name) return;
    setStore((st) => ({ ...st, profiles: st.profiles.map((p) => (p.id === id ? { ...p, name: name.trim() } : p)) }));
  }

  function deleteLanguage(id: string) {
    if (store.profiles.length <= 1) return;
    const target = store.profiles.find((p) => p.id === id);
    if (!target) return;
    if (!confirm(`Delete "${target.name}" from this device?`)) return;
    setStore((st) => {
      const remaining = st.profiles.filter((p) => p.id !== id);
      const activeId = st.activeId === id ? remaining[0].id : st.activeId;
      return { activeId, profiles: remaining };
    });
  }

  const premiumMark = (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <div
        aria-hidden="true"
        style={{
          width: 36,
          height: 36,
          borderRadius: 12,
          background:
            "radial-gradient(14px 14px at 30% 30%, rgba(255,255,255,0.85), rgba(255,255,255,0.0)), linear-gradient(180deg, rgba(37,99,235,0.95), rgba(37,99,235,0.55))",
          boxShadow: "0 12px 30px rgba(37,99,235,0.22), 0 6px 16px rgba(15,23,42,0.10)",
          border: "1px solid rgba(255,255,255,0.45)",
          display: "grid",
          placeItems: "center",
          color: "white",
          fontWeight: 950,
          letterSpacing: "-0.06em",
        }}
      >
        FH
      </div>
      <div>
        <div style={{ fontWeight: 950, letterSpacing: "-0.03em", fontSize: 18 }}>{APP_NAME}</div>
        <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 2 }}>{APP_SUBTITLE}</div>
      </div>
    </div>
  );

  const header = (
    <div
      style={{
        position: "sticky",
        top: 0,
        zIndex: 10,
        padding: "14px 14px 10px",
        background:
          "linear-gradient(180deg, rgba(37,99,235,0.18), rgba(255,255,255,0.40) 60%, rgba(255,255,255,0.0))",
        backdropFilter: "blur(14px)",
        WebkitBackdropFilter: "blur(14px)",
        borderBottom: "1px solid rgba(15,23,42,0.08)",
      }}
    >
      <div style={{ maxWidth: 980, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        {premiumMark}
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <MenuButton label="Language" value={activeProfile.name} onClick={() => setOpenLangMenu(true)} />
          <MenuButton label="Level" value={LEVELS.find((l) => l.key === progress.level)?.label || progress.level} onClick={() => setOpenLevelMenu(true)} />
          <MenuButton label="Mode" value={progress.mode === "path" ? "Path" : "Random"} onClick={() => setOpenModeMenu(true)} />
        </div>
        <div style={{ maxWidth: 980, margin: "10px auto 0", padding: "0 2px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, color: "var(--muted)", fontSize: 12 }}>
            <span>
              <b style={{ color: "var(--text)" }}>{totalHours}</b> / <b style={{ color: "var(--text)" }}>{goalHours}</b> hours
            </span>
            <span style={{ fontWeight: 900 }}>{totalPct}%</span>
          </div>
          <div style={{ height: 10, borderRadius: 999, background: "rgba(15,23,42,0.06)", overflow: "hidden", boxShadow: "var(--shadow-sm)", border: "1px solid rgba(15,23,42,0.06)" }}>
            <div style={{ width: `${totalPct}%`, height: "100%", background: "linear-gradient(90deg, rgba(37,99,235,0.55), rgba(37,99,235,0.25))" }} />
          </div>
        </div>

      </div>
    </div>
  );

  const nextUp = useMemo(() => {
    const list = sessionsByLevel[progress.level] || [];
    const done = progress.completedIdsByLevel[progress.level] || {};
    return computeNextSessionForLevel(list, done);
  }, [sessionsByLevel, progress.level, progress.completedIdsByLevel]);

  const home = (
    <>
      <div style={{ maxWidth: 980, margin: "0 auto", padding: 14, display: "grid", gap: 12 }}>
        <Card
          style={{ background: "rgba(255,255,255,0.78)" }}
          title="Your fluency goal"
          right={<Pill>{totalHours} hours • {totalPct}%</Pill>}
        >
          <div style={{ color: "var(--muted)", marginBottom: 10 }}>{APP_TAGLINE}</div>
          <div style={{ height: 10, borderRadius: 999, background: "rgba(15,23,42,0.06)", overflow: "hidden" }}>
            <div style={{ width: `${totalPct}%`, height: "100%", background: "rgba(37,99,235,0.40)" }} />
          </div>
          <div style={{ marginTop: 10, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div style={{ color: "var(--muted)", fontSize: 12 }}>
              Total: <b style={{ color: "var(--text)" }}>{totalHours}</b> of <b style={{ color: "var(--text)" }}>{goalHours}</b> hours
            </div>
            <div style={{ color: "var(--muted)", fontSize: 12 }}>
              Level {progress.level}: <b style={{ color: "var(--text)" }}>{completedCount}</b> of <b style={{ color: "var(--text)" }}>{totalCount}</b> completed
            </div>
          </div>
        </Card>

        {needsBackup && (
          <Card title="Backup reminder" subtle right={<SmallButton tone="primary" onClick={exportBackup}>Export</SmallButton>}>
            <div style={{ color: "var(--muted)", fontSize: 12 }}>Export a weekly backup so you never lose your progress.</div>
          </Card>
        )}

        <PrimaryButton onClick={chooseAndStart} disabled={loadingLibrary || !!libraryError || !currentLevelList.length}>
          Start my fluent hour
        </PrimaryButton>

        <Card title="Your path" right={<SmallButton onClick={() => setLevelSheet(progress.level)}>Checklist</SmallButton>}>
          <div style={{ color: "var(--muted)", fontSize: 12, marginBottom: 8 }}>
            {progress.mode === "path" ? "Continue in order. Mark complete at the end." : "Random practice inside your selected level."}
          </div>
          {nextUp ? (
            <div style={{ display: "grid", gap: 8 }}>
              <div style={{ fontWeight: 900 }}>{nextUp.title}</div>
              <div style={{ color: "var(--muted)", fontSize: 12 }}>
                {nextUp.context || "Tap start to begin."}
              </div>
            </div>
          ) : (
            <div style={{ color: "var(--muted)", fontSize: 12 }}>No sessions found for this level.</div>
          )}
        </Card>

        {(loadingLibrary || libraryError || !sessions.length) && (
          <Card title="Library status" subtle>
            {loadingLibrary && <div style={{ color: "var(--muted)" }}>Loading sessions…</div>}
            {!loadingLibrary && libraryError && (
              <div style={{ color: "var(--muted)" }}>
                {libraryError}
                <div style={{ marginTop: 8, fontSize: 12 }}>
                  Fix: ensure the file exists at <b>public/library/perfect-hour-data.txt</b>.
                </div>
              </div>
            )}
            {!loadingLibrary && !libraryError && !sessions.length && (
              <div style={{ color: "var(--muted)" }}>
                No sessions found. Confirm the BEGIN/END markers exist and are on their own lines.
              </div>
            )}
          </Card>
        )}

        <Card title="Levels" right={<SmallButton onClick={() => setLevelSheet(progress.level)}>Open</SmallButton>}>
          <div style={{ color: "var(--muted)", fontSize: 12, marginBottom: 10 }}>Tap a level to select it.</div>
          <div style={{ display: "grid", gap: 8 }}>
            {LEVELS.map((lvl) => {
              const cov = levelCoverage(lvl.key);
              const selected = lvl.key === progress.level;
              return (
                <button
                  key={lvl.key}
                  onClick={() => {
                    updateProgress((p) => ({ ...p, level: lvl.key }));
                    setLevelSheet(lvl.key);
                  }}
                  style={{
                    textAlign: "left",
                    padding: "12px 12px",
                    borderRadius: "var(--radius2)",
                    border: selected ? "1px solid rgba(37,99,235,0.32)" : "1px solid var(--border)",
                    background: selected ? "rgba(37,99,235,0.08)" : "rgba(255,255,255,0.70)",
                    boxShadow: "var(--shadow-sm)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 900 }}>{lvl.label}</div>
                    <div style={{ color: "var(--muted)", fontSize: 12 }}>
                      {cov.done} of {cov.total} • {cov.pct}%
                    </div>
                  </div>
                  <div
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 999,
                      border: "1px solid rgba(15,23,42,0.10)",
                      background: "rgba(255,255,255,0.70)",
                      display: "grid",
                      placeItems: "center",
                      boxShadow: "var(--shadow-sm)",
                    }}
                  >
                    <span style={{ fontWeight: 900, color: "rgba(15,23,42,0.75)" }}>{cov.pct}%</span>
                  </div>
                </button>
              );
            })}
          </div>
        </Card>

        <Card
          title="Advanced"
          right={<SoftButton onClick={() => setShowAdvanced((v) => !v)}>{showAdvanced ? "Hide" : "Show"}</SoftButton>}
        >
          {showAdvanced ? (
            <div style={{ display: "grid", gap: 12 }}>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <label style={{ display: "grid", gap: 6 }}>
                  <div style={{ color: "var(--muted)", fontSize: 12, fontWeight: 900 }}>Partner</div>
                  <select value={progress.partner} onChange={(e) => updateProgress((p) => ({ ...p, partner: e.target.value as PartnerMode }))}>
                    <option value="human">Language helper</option>
                    <option value="ai">AI helper</option>
                  </select>
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  <div style={{ color: "var(--muted)", fontSize: 12, fontWeight: 900 }}>Focus category</div>
                  <select value={progress.focusCategory} onChange={(e) => updateProgress((p) => ({ ...p, focusCategory: e.target.value as FocusCategory }))}>
                    {FOCUS_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  <div style={{ color: "var(--muted)", fontSize: 12, fontWeight: 900 }}>Goal hours</div>
                  <input
                    type="number"
                    min={1}
                    value={progress.time.goalHours}
                    onChange={(e) =>
                      updateProgress((p) => ({
                        ...p,
                        time: { ...p.time, goalHours: clamp(parseInt(e.target.value || "300", 10) || 300, 1, 10000) },
                      }))
                    }
                    style={{ width: 140 }}
                  />
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  <div style={{ color: "var(--muted)", fontSize: 12, fontWeight: 900 }}>Backup</div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <SmallButton tone="primary" onClick={exportBackup}>Export</SmallButton>
                    <label style={{ display: "inline-flex", alignItems: "center" }}>
                      <input
                        type="file"
                        accept="application/json"
                        style={{ display: "none" }}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) importBackupFile(f);
                          e.currentTarget.value = "";
                        }}
                      />
                      <SmallButton>Import</SmallButton>
                    </label>
                  </div>
                </label>
              </div>

              <Card title="Import a session" subtle right={<SoftButton onClick={() => setShowImport((v) => !v)}>{showImport ? "Hide" : "Show"}</SoftButton>}>
                {showImport ? (
                  <div style={{ display: "grid", gap: 10 }}>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <label style={{ display: "grid", gap: 6 }}>
                        <div style={{ color: "var(--muted)", fontSize: 12, fontWeight: 900 }}>Level</div>
                        <select value={importLevel} onChange={(e) => setImportLevel(e.target.value as LevelKey)}>
                          {LEVELS.map((l) => (
                            <option key={l.key} value={l.key}>
                              {l.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label style={{ display: "grid", gap: 6 }}>
                        <div style={{ color: "var(--muted)", fontSize: 12, fontWeight: 900 }}>Category</div>
                        <select value={importCategory} onChange={(e) => setImportCategory(e.target.value as FocusCategory)}>
                          {FOCUS_CATEGORIES.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>

                    <label style={{ display: "grid", gap: 6 }}>
                      <div style={{ color: "var(--muted)", fontSize: 12, fontWeight: 900 }}>Optional context (one sentence)</div>
                      <input value={importContext} onChange={(e) => setImportContext(e.target.value)} placeholder="Example: Istanbul street market, polite tone." />
                    </label>

                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <SmallButton
                        tone="primary"
                        onClick={() => {
                          const prompt = buildAIPrompt({ level: importLevel, category: importCategory, context: importContext });
                          navigator.clipboard.writeText(prompt);
                          setImportMsg("AI prompt copied. Generate one session and paste it below.");
                        }}
                      >
                        Copy AI prompt
                      </SmallButton>
                      <SmallButton onClick={doImport}>Import from paste</SmallButton>
                      {importMsg && <span style={{ color: "var(--muted)", fontSize: 12, alignSelf: "center" }}>{importMsg}</span>}
                    </div>

                    <label style={{ display: "grid", gap: 6 }}>
                      <div style={{ color: "var(--muted)", fontSize: 12, fontWeight: 900 }}>Paste AI output</div>
                      <textarea value={importPaste} onChange={(e) => setImportPaste(e.target.value)} placeholder="Paste the full BEGIN/END session block here." />
                    </label>
                  </div>
                ) : (
                  <div style={{ color: "var(--muted)", fontSize: 12 }}>Generate a session with AI → paste → import.</div>
                )}
              </Card>
            </div>
          ) : (
            <div style={{ color: "var(--muted)", fontSize: 12 }}>Optional settings, backup, and import.</div>
          )}
        </Card>
      </div>

      {/* Level checklist sheet */}
      <ModalSheet
        open={!!levelSheet}
        onClose={() => setLevelSheet(null)}
        title={levelSheet ? `${LEVELS.find((l) => l.key === levelSheet)?.label} checklist` : "Checklist"}
      >
        {levelSheet && (
          <div style={{ display: "grid", gap: 10 }}>
            <div style={{ color: "var(--muted)", fontSize: 12 }}>
              Click a row to start that session. Use the checkbox to restore or adjust completion.
            </div>
            <div style={{ display: "grid", gap: 8 }}>
              {(() => {
                const list = sortSessionsForPath(sessionsByLevel[levelSheet] || []);
                const doneMap = progress.completedIdsByLevel[levelSheet] || {};
                const incomplete = list.filter((s) => !doneMap[s.id]);
                const complete = list.filter((s) => !!doneMap[s.id]);

                const renderRow = (s: Session) => {
                  const done = !!doneMap[s.id];
                  return (
                    <div
                      key={s.id}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "44px 1fr",
                        gap: 10,
                        alignItems: "center",
                        padding: "10px 10px",
                        borderRadius: "var(--radius2)",
                        border: "1px solid var(--border)",
                        background: "rgba(255,255,255,0.72)",
                        boxShadow: "var(--shadow-sm)",
                      }}
                    >
                      <button
                        onClick={() => toggleComplete(levelSheet, s.id)}
                        aria-label={done ? "Mark incomplete" : "Mark complete"}
                        style={{
                          width: 42,
                          height: 42,
                          borderRadius: 12,
                          border: done ? "1px solid rgba(37,99,235,0.35)" : "1px solid rgba(15,23,42,0.12)",
                          background: done ? "rgba(37,99,235,0.12)" : "rgba(255,255,255,0.8)",
                          display: "grid",
                          placeItems: "center",
                          fontWeight: 950,
                        }}
                      >
                        {done ? "✓" : ""}
                      </button>
                      <button
                        onClick={() => {
                          startSession(s);
                          setLevelSheet(null);
                        }}
                        style={{
                          textAlign: "left",
                          padding: 0,
                          border: "none",
                          background: "transparent",
                          cursor: "pointer",
                        }}
                      >
                        <div style={{ fontWeight: 950, lineHeight: 1.2 }}>{s.title}</div>
                        <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 2 }}>
                          {s.context ? s.context : "Tap to start"}
                        </div>
                      </button>
                    </div>
                  );
                };

                return (
                  <>
                    {incomplete.map(renderRow)}
                    {complete.length > 0 && (
                      <details style={{ marginTop: 6 }}>
                        <summary style={{ cursor: "pointer", color: "var(--muted)", fontWeight: 900 }}>
                          Completed ({complete.length})
                        </summary>
                        <div style={{ display: "grid", gap: 8, marginTop: 8 }}>{complete.map(renderRow)}</div>
                      </details>
                    )}
                  </>
                );
              })()}
            </div>
          </div>
        )}
      </ModalSheet>
    </>
  );

  const sessionUI = (() => {
    const s = active;
    if (!s) return null;
    const phase = s.phases[phaseIdx];
    const mm = Math.floor(secondsLeft / 60);
    const ss = secondsLeft % 60;
    const timeStr = `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;

    const situation = s.context || "Practice a realistic situation for your level.";

    return (
      <div style={{ maxWidth: 980, margin: "0 auto", padding: 14, display: "grid", gap: 12 }}>
        <Card
          title={s.title}
          right={
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
              <Pill>{s.levelKey}</Pill>
              <Pill>{progress.partner === "human" ? "Language helper" : "AI helper"}</Pill>
              <Pill>{activeProfile.name}</Pill>
            </div>
          }
        >
          <div style={{ color: "var(--muted)", fontSize: 12 }}>{s.levelRaw || ""}</div>
          <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div style={{ fontSize: 40, fontWeight: 950, letterSpacing: "-0.04em" }}>{timeStr}</div>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <SoftButton onClick={sessionEnded ? finishSession : toggleRun}>{sessionEnded ? "Finish" : running ? "Pause" : "Start"}</SoftButton>
                <SoftButton onClick={skipToNext} disabled={sessionEnded}>Skip to next</SoftButton>
                <SoftButton
                  onClick={() => {
                    finishSession();
                  }}
                >
                  Exit
                </SoftButton>
              </div>
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {s.phases.map((p, idx) => (
                <Pill key={idx}>{idx === phaseIdx ? <b>Now</b> : phaseDone[idx] ? "Done" : "Next"}: {p.minutes}m</Pill>
              ))}
            </div>

            {sessionEnded && (
              <div
                style={{
                  display: "grid",
                  gap: 8,
                  padding: "10px 12px",
                  borderRadius: 12,
                  border: "1px solid rgba(37,99,235,0.22)",
                  background: "rgba(37,99,235,0.06)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                  <div style={{ color: "var(--muted)", fontSize: 12 }}>
                    Logged this session: <b style={{ color: "var(--text)" }}>{minsFromMs(sessionLoggedMsNow())} min</b> (already added to your total)
                  </div>
                  {(progress.completedIdsByLevel[s.levelKey] || {})[s.id] && <Pill>Completed ✓</Pill>}
                </div>

                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                  {(progress.completedIdsByLevel[s.levelKey] || {})[s.id] ? (
                    <SmallButton tone="primary" onClick={finishSession}>Return home</SmallButton>
                  ) : (
                    <>
                      <SmallButton tone="primary" onClick={markCompleteAndReturn}>Mark complete + return</SmallButton>
                      <SmallButton onClick={finishSession}>Return without marking</SmallButton>
                    </>
                  )}
                </div>

                <div style={{ color: "var(--muted)", fontSize: 12 }}>
                  You’ll see your progress thermometer update immediately on the Home screen.
                </div>
              </div>
            )}
          </div>
        </Card>

        <Card title="Learner" right={<Pill>{phase?.name || "Phase"}</Pill>}>
          <div style={{ color: "var(--muted)", marginBottom: 8 }}>
            Situation: <b style={{ color: "var(--text)" }}>{situation}</b>
          </div>
          <div style={{ color: "var(--muted)", fontSize: 12, marginBottom: 10 }}>
            {phase?.purpose ? phase.purpose : "Follow the steps. Keep turns short. Stay relaxed."}
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            {(phase?.humanSteps?.length ? phase.humanSteps : ["Follow the helper’s lead and keep it simple."]).map((step, idx) => (
              <div key={idx} style={{ display: "flex", gap: 10 }}>
                <div style={{ width: 20, height: 20, borderRadius: 6, border: "1px solid rgba(15,23,42,0.12)", background: "rgba(255,255,255,0.75)", display: "grid", placeItems: "center", fontWeight: 950 }}>
                  {idx + 1}
                </div>
                <div style={{ lineHeight: 1.35 }}>{step}</div>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Advanced" right={<SoftButton onClick={() => setShowAdvanced((v) => !v)}>{showAdvanced ? "Hide" : "Show"}</SoftButton>}>
          {showAdvanced ? (
            <div style={{ display: "grid", gap: 12 }}>
              <Card title="Helper (shows when paused)" subtle>
                {running ? (
                  <div style={{ color: "var(--muted)", fontSize: 12 }}>Pause to view the helper guidance.</div>
                ) : (
                  <div style={{ color: "var(--text)", lineHeight: 1.45 }}>
                    {phase?.aiScript ? phase.aiScript : "Coach the learner with short turns and gentle recasts."}
                    {s.correction && (
                      <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 8 }}>Correction focus: {s.correction}</div>
                    )}
                  </div>
                )}
              </Card>

              <Card title="Localize for your context" subtle right={<SoftButton onClick={() => setShowLocalize((v) => !v)}>{showLocalize ? "Hide" : "Show"}</SoftButton>}>
                {showLocalize ? (
                  <div style={{ color: "var(--muted)", lineHeight: 1.5 }}>
                    <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
                      <li>Adjust politeness, distance, and turn-length for your culture (Istanbul, Paris, PNG villages, Oman).</li>
                      <li>Keep the same “can-do” goal; swap the setting, roles, and social expectations.</li>
                      <li>Use the same correction focus: one gentle recast, then repeat the clean version.</li>
                      <li>If a scenario is sensitive, reframe it to a safer equivalent while keeping the language function.</li>
                    </ul>
                  </div>
                ) : (
                  <div style={{ color: "var(--muted)", fontSize: 12 }}>Tips for adapting across cultures.</div>
                )}
              </Card>

              {s.twists?.length > 0 && (
                <Card title="Twists" subtle>
                  <div style={{ display: "grid", gap: 6 }}>
                    {s.twists.slice(0, 6).map((t, idx) => (
                      <div key={idx} style={{ color: "var(--muted)" }}>• {t}</div>
                    ))}
                  </div>
                </Card>
              )}
            </div>
          ) : (
            <div style={{ color: "var(--muted)", fontSize: 12 }}>Helper guidance, localization tips, and twists.</div>
          )}
        </Card>
      </div>
    );
  })();

  return (
    <ErrorBoundary>
      {header}

      {openLangMenu && (
        <ModalSheet open={true} onClose={() => setOpenLangMenu(false)} title="Language profiles">
          <div style={{ display: "grid", gap: 10 }}>
            <div style={{ color: "var(--muted)", fontSize: 12 }}>Each language tracks its own hours, completion, and imports.</div>
            <div style={{ display: "grid", gap: 8 }}>
              {store.profiles.map((p) => {
                const active = p.id === store.activeId;
                const hrs = formatHrs(p.progress.time.totalMs);
                return (
                  <div
                    key={p.id}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr auto",
                      gap: 10,
                      padding: 12,
                      borderRadius: "var(--radius2)",
                      border: active ? "1px solid rgba(37,99,235,0.30)" : "1px solid var(--border)",
                      background: active ? "rgba(37,99,235,0.06)" : "rgba(255,255,255,0.74)",
                      boxShadow: "var(--shadow-sm)",
                      alignItems: "center",
                    }}
                  >
                    <button
                      onClick={() => {
                        setStore((st) => ({ ...st, activeId: p.id }));
                        setOpenLangMenu(false);
                      }}
                      style={{ textAlign: "left", border: "none", background: "transparent", padding: 0, cursor: "pointer" }}
                    >
                      <div style={{ fontWeight: 950 }}>{p.name}</div>
                      <div style={{ color: "var(--muted)", fontSize: 12 }}>{hrs} hours • Level {p.progress.level}</div>
                    </button>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                      <SmallButton onClick={() => renameLanguage(p.id)}>Rename</SmallButton>
                      <SmallButton onClick={() => deleteLanguage(p.id)} disabled={store.profiles.length <= 1}>Delete</SmallButton>
                    </div>
                  </div>
                );
              })}
            </div>
            <SmallButton tone="primary" onClick={addLanguage}>Add language</SmallButton>
          </div>
        </ModalSheet>
      )}

      {openLevelMenu && (
        <MenuList<LevelKey>
          title="Choose level"
          value={progress.level}
          onClose={() => setOpenLevelMenu(false)}
          onPick={(v) => {
            updateProgress((p) => ({ ...p, level: v }));
            setOpenLevelMenu(false);
          }}
          options={LEVELS.map((l) => ({ value: l.key, label: l.label }))}
        />
      )}

      {openModeMenu && (
        <MenuList<Mode>
          title="Choose mode"
          value={progress.mode}
          onClose={() => setOpenModeMenu(false)}
          onPick={(v) => {
            updateProgress((p) => ({ ...p, mode: v }));
            setOpenModeMenu(false);
          }}
          options={[
            { value: "path", label: "Path", sub: "Continue in order and mark complete" },
            { value: "random", label: "Random", sub: "Variety practice inside your selected level" },
          ]}
        />
      )}

      {toast && <Toast message={toast} />}

      {screen === "HOME" ? home : sessionUI}
    </ErrorBoundary>
  );
}
