import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * FluentHour — Premium, local-first, two-screen app.
 * HOME: pick level + mode, see progress, start a session
 * SESSION: run the phases with autopause, mark complete at end
 *
 * Library file (recommended):
 *   public/library/perfect-hour-data.txt  -> fetched at /library/perfect-hour-data.txt
 *
 * Data blocks:
 *   BEGIN PERFECT HOUR SESSION
 *   ...
 *   END PERFECT HOUR SESSION
 */

const APP_NAME = "FluentHour";
const APP_SUBTITLE = "Guided speaking practice • Canadian benchmarks";
const APP_TAGLINE =
  "Three hundred plus hours of guided speaking practice to level up your fluency. Set your goal, start at your level, and follow the steps with a language helper.";

type Screen = "HOME" | "SESSION";

type LevelKey = "A1" | "A2" | "B1" | "B2" | "C1" | "C2";
const LEVELS: { key: LevelKey; label: string }[] = [
  { key: "A1", label: "A one" },
  { key: "A2", label: "A two" },
  { key: "B1", label: "B one" },
  { key: "B2", label: "B two" },
  { key: "C1", label: "C one" },
  { key: "C2", label: "C two" },
];

type Mode = "random" | "path";
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
  id: string; // stable identifier (ID: if present, else derived)
  title: string;
  levelKey: LevelKey;
  levelRaw?: string;
  partner?: string;
  goal?: string;
  context?: string;
  correction?: string;
  twists: string[];
  phases: Phase[];
  // optional focus category for user-generated sessions
  category?: FocusCategory;
  // raw block for debugging
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
};

const LS_KEY = "fluenthour.state.v2";

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
  // one decimal, but avoid "-0.0"
  const rounded = Math.max(0, Math.round(hours * 10) / 10);
  return rounded;
}

function percent(n: number, d: number) {
  if (d <= 0) return 0;
  return Math.round((n / d) * 100);
}

function makeDefaultState(): ProgressState {
  const emptyRecent: Record<LevelKey, string[]> = {
    A1: [],
    A2: [],
    B1: [],
    B2: [],
    C1: [],
    C2: [],
  };
  const emptyCompleted: Record<LevelKey, Record<string, true>> = {
    A1: {},
    A2: {},
    B1: {},
    B2: {},
    C1: {},
    C2: {},
  };
  return {
    level: "A2",
    mode: "random",
    partner: "human",
    focusCategory: "General",
    recentIdsByLevel: emptyRecent,
    completedIdsByLevel: emptyCompleted,
    time: { totalMs: 0, goalHours: 300 },
  };
}

function loadState(): ProgressState {
  const parsed = safeJsonParse<ProgressState>(localStorage.getItem(LS_KEY));
  if (!parsed) return makeDefaultState();
  // merge with defaults to handle new keys
  const def = makeDefaultState();
  return {
    ...def,
    ...parsed,
    recentIdsByLevel: { ...def.recentIdsByLevel, ...(parsed.recentIdsByLevel || {}) },
    completedIdsByLevel: { ...def.completedIdsByLevel, ...(parsed.completedIdsByLevel || {}) },
    time: { ...def.time, ...(parsed.time || {}) },
  };
}

function saveState(s: ProgressState) {
  localStorage.setItem(LS_KEY, JSON.stringify(s));
}

/** Robust fetch: Vite/Netlify may serve index.html for missing assets. Detect and reject HTML. */
async function fetchLibraryText(url: string): Promise<string> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Library fetch failed: ${res.status}`);
  const text = await res.text();
  const trimmed = text.trimStart();
  if (trimmed.startsWith("<!DOCTYPE html") || trimmed.startsWith("<html")) {
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
  // unsigned
  return `${levelKey}_${(h >>> 0).toString(16)}`;
}

function parseSessionBlock(block: string): Session | null {
  // Simple line-oriented parse; tolerant of missing fields.
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

  // Parse twists
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

  // Parse phases
  const phases: Phase[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (/^PHASE\s+\d+/i.test(line)) {
      // scan until next PHASE or END
      let name = "";
      let minutes = 0;
      let purpose = "";
      const humanSteps: string[] = [];
      let aiScript = "";
      i++;
      for (; i < lines.length; i++) {
        const l = lines[i];
        const t = l.trim();
        if (/^PHASE\s+\d+/i.test(t) || t === "END PERFECT HOUR SESSION") {
          i--; // let outer loop re-handle
          break;
        }
        if (t.startsWith("Name:")) name = t.slice("Name:".length).trim();
        else if (t.startsWith("Minutes:")) {
          const n = parseInt(t.slice("Minutes:".length).trim(), 10);
          minutes = Number.isFinite(n) ? n : minutes;
        } else if (t.startsWith("Purpose:")) purpose = t.slice("Purpose:".length).trim();
        else if (t === "Human steps:" || t === "Human steps") {
          // collect bullet lines until AI helper script or blank line that ends bullets
          for (i = i + 1; i < lines.length; i++) {
            const bl = lines[i].trim();
            if (!bl) continue;
            if (bl.startsWith("AI helper script:") || bl.startsWith("AI helper script")) {
              i--; // let next section handle
              break;
            }
            if (bl.startsWith("*")) humanSteps.push(bl.replace(/^\*\s*/, "").trim());
            else if (bl.startsWith("-")) humanSteps.push(bl.replace(/^\-\s*/, "").trim());
            else if (/^PHASE\s+\d+/i.test(bl) || bl === "END PERFECT HOUR SESSION") {
              i--;
              break;
            } else humanSteps.push(bl);
          }
        } else if (t.startsWith("AI helper script:")) {
          aiScript = t.slice("AI helper script:".length).trim();
          // allow multi-line script until blank or next section
          for (i = i + 1; i < lines.length; i++) {
            const nl = lines[i].trim();
            if (!nl) continue;
            if (/^PHASE\s+\d+/i.test(nl) || nl === "END PERFECT HOUR SESSION" || nl === "Twists:") {
              i--;
              break;
            }
            // stop if a clear new field begins
            if (nl.startsWith("Name:") || nl.startsWith("Minutes:") || nl.startsWith("Purpose:") || nl === "Human steps:") {
              i--;
              break;
            }
            aiScript += " " + nl;
          }
        }
      }
      phases.push({
        name: name || `Phase ${phases.length + 1}`,
        minutes: minutes || 0,
        purpose: purpose || undefined,
        humanSteps,
        aiScript: aiScript || undefined,
      });
    }
    i++;
  }

  // Minimum viability: must have markers and title
  const s: Session = {
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

  return s;
}

function sortSessionsForPath(list: Session[]) {
  // Stable, human-friendly ordering
  return [...list].sort((a, b) => a.title.localeCompare(b.title));
}

function pickRandomWithVariety(list: Session[], recent: string[], maxRecent = 6) {
  if (!list.length) return null;
  const recentSet = new Set(recent.slice(-maxRecent));
  const candidates = list.filter((s) => !recentSet.has(s.id));
  const pool = candidates.length ? candidates : list;
  const chosen = pool[Math.floor(Math.random() * pool.length)];
  return chosen;
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
          {title ? (
            <div style={{ fontWeight: 700, letterSpacing: "-0.01em" }}>
              {title}
            </div>
          ) : (
            <div />
          )}
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
        background:
          "linear-gradient(180deg, rgba(37,99,235,0.14), rgba(37,99,235,0.08))",
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

/** Small, robust Error Boundary */
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean; message?: string }> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError(err: any) {
    return { hasError: true, message: String(err?.message || err) };
  }
  componentDidCatch() {
    // no-op: keep it quiet in production
  }
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
          width: "min(520px, 92vw)",
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
          <div style={{ fontWeight: 900, letterSpacing: "-0.02em" }}>{title}</div>
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
        fontWeight: 800,
      }}
    >
      <span style={{ color: "rgba(15,23,42,0.70)", fontWeight: 800 }}>{props.label}</span>
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
              <div style={{ fontWeight: 850 }}>{o.label}</div>
              {o.sub && <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 2 }}>{o.sub}</div>}
            </button>
          );
        })}
      </div>
    </ModalSheet>
  );
}

/** Import AI sessions: strict template + paste box */
function buildAIPrompt(args: { level: LevelKey; category: FocusCategory; context: string }) {
  const { level, category, context } = args;
  const contextLine = context.trim() ? `\nUser context: ${context.trim()}\n` : "\n";
  return [
    "You are generating FluentHour session content.",
    "",
    "Output EXACTLY one session in this format (no markdown, no extra commentary):",
    "",
    "BEGIN PERFECT HOUR SESSION",
    `Title: <short action title>`,
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

export default function App() {
  const [screen, setScreen] = useState<Screen>("HOME");
  const [state, setState] = useState<ProgressState>(() => loadState());

  const [libraryText, setLibraryText] = useState<string>("");
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [loadingLibrary, setLoadingLibrary] = useState<boolean>(true);

  const [sessions, setSessions] = useState<Session[]>([]);
  const sessionsByLevel = useMemo(() => {
    const map: Record<LevelKey, Session[]> = { A1: [], A2: [], B1: [], B2: [], C1: [], C2: [] };
    for (const s of sessions) map[s.levelKey].push(s);
    return map;
  }, [sessions]);

  // Menu sheets
  const [openLevelMenu, setOpenLevelMenu] = useState(false);
  const [openModeMenu, setOpenModeMenu] = useState(false);

  // Checklist sheet
  const [levelSheet, setLevelSheet] = useState<LevelKey | null>(null);

  // Session runner
  const [active, setActive] = useState<Session | null>(null);
  const [phaseIdx, setPhaseIdx] = useState<number>(0);
  const [secondsLeft, setSecondsLeft] = useState<number>(0);
  const [running, setRunning] = useState<boolean>(false);
  const [phaseDone, setPhaseDone] = useState<Record<number, true>>({});
  const [sessionEnded, setSessionEnded] = useState<boolean>(false);
  const tickRef = useRef<number | null>(null);
  const runStartedAtRef = useRef<number | null>(null);

  const [showAdvanced, setShowAdvanced] = useState<boolean>(false);
  const [showImport, setShowImport] = useState<boolean>(false);
  const [showLocalize, setShowLocalize] = useState<boolean>(false);

  const [importLevel, setImportLevel] = useState<LevelKey>("A2");
  const [importCategory, setImportCategory] = useState<FocusCategory>("General");
  const [importContext, setImportContext] = useState<string>("");
  const [importPaste, setImportPaste] = useState<string>("");
  const [importMsg, setImportMsg] = useState<string>("");

  // Persist state
  useEffect(() => {
    saveState(state);
  }, [state]);

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

  // Parse sessions when text changes
  useEffect(() => {
    if (!libraryText) return;
    const blocks = extractBlocks(libraryText);
    const parsed: Session[] = [];
    for (const b of blocks) {
      const s = parseSessionBlock(b);
      if (s) parsed.push(s);
    }
    setSessions(parsed);
  }, [libraryText]);

  // Runner ticking
  useEffect(() => {
    if (!running) {
      if (tickRef.current) {
        window.clearInterval(tickRef.current);
        tickRef.current = null;
      }
      // when stopping, accrue time from runStartedAtRef
      if (runStartedAtRef.current != null) {
        const elapsed = nowMs() - runStartedAtRef.current;
        runStartedAtRef.current = null;
        if (elapsed > 0) {
          setState((s) => ({ ...s, time: { ...s.time, totalMs: s.time.totalMs + elapsed } }));
        }
      }
      return;
    }

    // starting
    if (runStartedAtRef.current == null) runStartedAtRef.current = nowMs();

    tickRef.current = window.setInterval(() => {
      setSecondsLeft((sec) => {
        if (sec <= 1) {
          // phase ends: autopause
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
  }, [running]);

  const currentLevelList = sessionsByLevel[state.level] || [];
  const pathSorted = useMemo(() => sortSessionsForPath(currentLevelList), [currentLevelList]);
  const completedMap = state.completedIdsByLevel[state.level] || {};
  const completedCount = Object.keys(completedMap).length;
  const totalCount = currentLevelList.length;

  const totalHours = formatHrs(state.time.totalMs);
  const goalHours = Math.max(1, state.time.goalHours);
  const totalPct = clamp(Math.round((totalHours / goalHours) * 100), 0, 100);

  const levelCoverage = (lvl: LevelKey) => {
    const total = (sessionsByLevel[lvl] || []).length;
    const done = Object.keys(state.completedIdsByLevel[lvl] || {}).length;
    return { total, done, pct: percent(done, total) };
  };

  function startSession(session: Session) {
    setActive(session);
    setScreen("SESSION");
    setPhaseIdx(0);
    setPhaseDone({});
    setSessionEnded(false);
    const first = session.phases[0];
    setSecondsLeft((first?.minutes || 0) * 60);
    setRunning(false);
    setShowAdvanced(false);
    setShowLocalize(false);
  }

  function chooseAndStart() {
    const list = sessionsByLevel[state.level] || [];
    if (!list.length) return;
    if (state.mode === "path") {
      const sorted = sortSessionsForPath(list);
      const done = state.completedIdsByLevel[state.level] || {};
      const next = sorted.find((s) => !done[s.id]) || sorted[0];
      startSession(next);
      return;
    }
    // random
    const recent = state.recentIdsByLevel[state.level] || [];
    const chosen = pickRandomWithVariety(list, recent, 6) || list[0];
    setState((s) => {
      const prev = s.recentIdsByLevel[s.level] || [];
      const nextRecent = [...prev, chosen.id].slice(-12);
      return { ...s, recentIdsByLevel: { ...s.recentIdsByLevel, [s.level]: nextRecent } };
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
    // counts as done even if skipped
    markPhaseDoneAndAdvance();
  }

  function toggleRun() {
    if (!active) return;
    if (sessionEnded) return;
    if (!secondsLeft) {
      // phase ended; advance
      markPhaseDoneAndAdvance();
      return;
    }
    setRunning((r) => !r);
  }

  function markSessionComplete() {
    if (!active) return;
    setState((s) => {
      const lvl = active.levelKey;
      const done = { ...(s.completedIdsByLevel[lvl] || {}) };
      done[active.id] = true;
      return { ...s, completedIdsByLevel: { ...s.completedIdsByLevel, [lvl]: done } };
    });
  }

  function toggleComplete(lvl: LevelKey, id: string) {
    setState((s) => {
      const done = { ...(s.completedIdsByLevel[lvl] || {}) };
      if (done[id]) delete done[id];
      else done[id] = true;
      return { ...s, completedIdsByLevel: { ...s.completedIdsByLevel, [lvl]: done } };
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
    const parsed: Session[] = [];
    for (const b of blocks) {
      const s = parseSessionBlock(b);
      if (s) parsed.push({ ...s, levelKey: importLevel, category: importCategory });
    }
    if (!parsed.length) {
      setImportMsg("That block didn’t parse into a usable session.");
      return;
    }
    // Append into in-memory library (local-only). For a true local library, you'd store these in localStorage.
    setSessions((prev) => [...prev, ...parsed]);
    setImportPaste("");
    setImportMsg(`Imported ${parsed.length} session(s) into this device.`);
  }

  const header = (
    <div
      style={{
        position: "sticky",
        top: 0,
        zIndex: 10,
        padding: "14px 14px 10px",
        background:
          "linear-gradient(180deg, rgba(37,99,235,0.16), rgba(255,255,255,0.35) 60%, rgba(255,255,255,0.0))",
        backdropFilter: "blur(14px)",
        WebkitBackdropFilter: "blur(14px)",
        borderBottom: "1px solid rgba(15,23,42,0.08)",
      }}
    >
      <div style={{ maxWidth: 980, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div style={{ fontWeight: 950, letterSpacing: "-0.03em", fontSize: 18 }}>{APP_NAME}</div>
          <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 2 }}>{APP_SUBTITLE}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <MenuButton
            label="Level"
            value={LEVELS.find((l) => l.key === state.level)?.label || state.level}
            onClick={() => setOpenLevelMenu(true)}
          />
          <MenuButton
            label="Mode"
            value={state.mode === "random" ? "Random" : "Path"}
            onClick={() => setOpenModeMenu(true)}
          />
        </div>
      </div>
    </div>
  );

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
              Level {state.level}: <b style={{ color: "var(--text)" }}>{completedCount}</b> of <b style={{ color: "var(--text)" }}>{totalCount}</b> completed
            </div>
          </div>
        </Card>

        <PrimaryButton onClick={chooseAndStart} disabled={loadingLibrary || !!libraryError || !currentLevelList.length}>
          Start my fluent hour
        </PrimaryButton>

        {(loadingLibrary || libraryError) && (
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

        <Card
          title="Levels"
          right={
            <SoftButton onClick={() => setLevelSheet(state.level)} disabled={!sessionsByLevel[state.level]?.length}>
              Open checklist
            </SoftButton>
          }
        >
          <div style={{ color: "var(--muted)", fontSize: 12, marginBottom: 10 }}>Tap a level to select it.</div>
          <div style={{ display: "grid", gap: 8 }}>
            {LEVELS.map((lvl) => {
              const cov = levelCoverage(lvl.key);
              const selected = lvl.key === state.level;
              return (
                <button
                  key={lvl.key}
                  onClick={() => setState((s) => ({ ...s, level: lvl.key }))}
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
                  <div style={{ width: 44, height: 44, borderRadius: 999, border: "1px solid rgba(15,23,42,0.10)", background: "rgba(255,255,255,0.70)", display: "grid", placeItems: "center", boxShadow: "var(--shadow-sm)" }}>
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
                  <div style={{ color: "var(--muted)", fontSize: 12, fontWeight: 800 }}>Partner</div>
                  <select
                    value={state.partner}
                    onChange={(e) => setState((s) => ({ ...s, partner: (e.target.value as PartnerMode) || "human" }))}
                  >
                    <option value="human">Language helper</option>
                    <option value="ai">AI helper</option>
                  </select>
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  <div style={{ color: "var(--muted)", fontSize: 12, fontWeight: 800 }}>Focus category</div>
                  <select
                    value={state.focusCategory}
                    onChange={(e) => setState((s) => ({ ...s, focusCategory: (e.target.value as FocusCategory) || "General" }))}
                  >
                    {FOCUS_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  <div style={{ color: "var(--muted)", fontSize: 12, fontWeight: 800 }}>Goal hours</div>
                  <input
                    type="number"
                    min={1}
                    value={state.time.goalHours}
                    onChange={(e) => setState((s) => ({ ...s, time: { ...s.time, goalHours: clamp(parseInt(e.target.value || "300", 10) || 300, 1, 10000) } }))}
                    style={{ width: 140 }}
                  />
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  <div style={{ color: "var(--muted)", fontSize: 12, fontWeight: 800 }}>Reset totals</div>
                  <SoftButton
                    onClick={() => {
                      if (confirm("Reset your total hours and completion?")) setState(makeDefaultState());
                    }}
                  >
                    Reset
                  </SoftButton>
                </label>
              </div>

              <Card
                title="Import a session"
                subtle
                right={<SoftButton onClick={() => setShowImport((v) => !v)}>{showImport ? "Hide" : "Show"}</SoftButton>}
              >
                {showImport ? (
                  <div style={{ display: "grid", gap: 10 }}>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <label style={{ display: "grid", gap: 6 }}>
                        <div style={{ color: "var(--muted)", fontSize: 12, fontWeight: 800 }}>Level</div>
                        <select value={importLevel} onChange={(e) => setImportLevel(e.target.value as LevelKey)}>
                          {LEVELS.map((l) => (
                            <option key={l.key} value={l.key}>
                              {l.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label style={{ display: "grid", gap: 6 }}>
                        <div style={{ color: "var(--muted)", fontSize: 12, fontWeight: 800 }}>Category</div>
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
                      <div style={{ color: "var(--muted)", fontSize: 12, fontWeight: 800 }}>Optional context (one sentence)</div>
                      <input value={importContext} onChange={(e) => setImportContext(e.target.value)} placeholder="Example: Istanbul street market, polite tone." />
                    </label>

                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <SoftButton
                        onClick={() => {
                          const prompt = buildAIPrompt({ level: importLevel, category: importCategory, context: importContext });
                          navigator.clipboard.writeText(prompt);
                          setImportMsg("AI prompt copied. Paste it into your AI and generate one session.");
                        }}
                      >
                        Copy AI prompt
                      </SoftButton>
                      <SoftButton onClick={doImport}>Import from paste</SoftButton>
                      {importMsg && <span style={{ color: "var(--muted)", fontSize: 12, alignSelf: "center" }}>{importMsg}</span>}
                    </div>

                    <label style={{ display: "grid", gap: 6 }}>
                      <div style={{ color: "var(--muted)", fontSize: 12, fontWeight: 800 }}>Paste AI output</div>
                      <textarea value={importPaste} onChange={(e) => setImportPaste(e.target.value)} placeholder="Paste the full BEGIN/END session block here." />
                    </label>
                  </div>
                ) : (
                  <div style={{ color: "var(--muted)", fontSize: 12 }}>Generate a session with AI → paste → import.</div>
                )}
              </Card>
            </div>
          ) : (
            <div style={{ color: "var(--muted)", fontSize: 12 }}>Optional settings and import.</div>
          )}
        </Card>
      </div>

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
                const doneMap = state.completedIdsByLevel[levelSheet] || {};
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
                          fontWeight: 900,
                        }}
                      >
                        {done ? "✓" : ""}
                      </button>
                      <button
                        onClick={() => startSession(s)}
                        style={{
                          textAlign: "left",
                          padding: 0,
                          border: "none",
                          background: "transparent",
                          cursor: "pointer",
                        }}
                      >
                        <div style={{ fontWeight: 900, lineHeight: 1.2 }}>{s.title}</div>
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
                        <summary style={{ cursor: "pointer", color: "var(--muted)", fontWeight: 800 }}>
                          Completed ({complete.length})
                        </summary>
                        <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                          {complete.map(renderRow)}
                        </div>
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
    const totalSeconds = (phase?.minutes || 0) * 60;
    const done = phaseDone[phaseIdx] === true;

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
              <Pill>{state.partner === "human" ? "Language helper" : "AI helper"}</Pill>
            </div>
          }
        >
          <div style={{ color: "var(--muted)", fontSize: 12 }}>{s.levelRaw || ""}</div>
          <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div style={{ fontSize: 40, fontWeight: 950, letterSpacing: "-0.04em" }}>{timeStr}</div>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <SoftButton onClick={toggleRun}>
                  {sessionEnded ? "Done" : running ? "Pause" : "Start"}
                </SoftButton>
                <SoftButton onClick={skipToNext} disabled={sessionEnded}>
                  Skip to next
                </SoftButton>
                <SoftButton onClick={() => { setRunning(false); setScreen("HOME"); }}>
                  Exit
                </SoftButton>
              </div>
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {s.phases.map((p, idx) => (
                <Pill key={idx}>
                  {idx === phaseIdx ? <b>Now</b> : phaseDone[idx] ? "Done" : "Next"}: {p.minutes}m
                </Pill>
              ))}
            </div>

            {sessionEnded && (
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                <SoftButton onClick={markSessionComplete}>Mark complete</SoftButton>
                <span style={{ color: "var(--muted)", fontSize: 12 }}>
                  Completion updates level coverage. Total hours always count.
                </span>
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
                <div style={{ width: 20, height: 20, borderRadius: 6, border: "1px solid rgba(15,23,42,0.12)", background: "rgba(255,255,255,0.75)", display: "grid", placeItems: "center", fontWeight: 900 }}>
                  {idx + 1}
                </div>
                <div style={{ lineHeight: 1.35 }}>{step}</div>
              </div>
            ))}
          </div>
        </Card>

        <Card
          title="Advanced"
          right={<SoftButton onClick={() => setShowAdvanced((v) => !v)}>{showAdvanced ? "Hide" : "Show"}</SoftButton>}
        >
          {showAdvanced ? (
            <div style={{ display: "grid", gap: 12 }}>
              <Card title="Helper (shows when paused)" subtle>
                {running ? (
                  <div style={{ color: "var(--muted)", fontSize: 12 }}>Pause to view the helper guidance.</div>
                ) : (
                  <div style={{ color: "var(--text)", lineHeight: 1.45 }}>
                    {phase?.aiScript ? phase.aiScript : "Coach the learner with short turns and gentle recasts."}
                    {s.correction && (
                      <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 8 }}>
                        Correction focus: {s.correction}
                      </div>
                    )}
                  </div>
                )}
              </Card>

              <Card
                title="Localize for your context"
                subtle
                right={<SoftButton onClick={() => setShowLocalize((v) => !v)}>{showLocalize ? "Hide" : "Show"}</SoftButton>}
              >
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
                      <div key={idx} style={{ color: "var(--muted)" }}>
                        • {t}
                      </div>
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

      {openLevelMenu && (
        <MenuList<LevelKey>
          title="Choose level"
          value={state.level}
          onClose={() => setOpenLevelMenu(false)}
          onPick={(v) => {
            setState((s) => ({ ...s, level: v }));
            setOpenLevelMenu(false);
          }}
          options={LEVELS.map((l) => ({ value: l.key, label: l.label }))}
        />
      )}

      {openModeMenu && (
        <MenuList<Mode>
          title="Choose mode"
          value={state.mode}
          onClose={() => setOpenModeMenu(false)}
          onPick={(v) => {
            setState((s) => ({ ...s, mode: v }));
            setOpenModeMenu(false);
          }}
          options={[
            { value: "random", label: "Random", sub: "Variety practice inside your selected level" },
            { value: "path", label: "Path", sub: "Continue through uncompleted sessions in your selected level" },
          ]}
        />
      )}

      {screen === "HOME" ? home : sessionUI}
    </ErrorBoundary>
  );
}
