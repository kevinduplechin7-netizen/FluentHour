import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * FluentHour — premium, local-first
 * Two screens: HOME + SESSION
 * Library source: public/library/perfect-hour-data.txt (served at /library/perfect-hour-data.txt)
 */

type Screen = "home" | "session";
type CEFRLevel = "A1" | "A2" | "B1" | "B2" | "C1" | "C2";
type Mode = "random" | "path";
type PartnerMode = "human" | "ai";

type Category =
  | "Everyday"
  | "Travel & Transit"
  | "Food & Ordering"
  | "Housing & Errands"
  | "Work & Professional"
  | "Social & Relationships"
  | "Health & Emergencies"
  | "Culture & Politeness"
  | "Problem Solving"
  | "Paperwork & Admin"
  | "Family & Kids"
  | "Spiritual & Ministry"
  | "Other";

type Phase = {
  id: string;
  title: string;
  minutes: number;
  purpose: string;
  learnerSteps: string[];
  helperScript: string;
};

type Template = {
  id: string;
  title: string;
  level: CEFRLevel;
  partner: "human" | "ai" | "either";
  goalCLB?: string;
  context: string;
  correction?: string;
  category: Category;
  phases: Phase[];
  twists: string[];
  source: "library" | "import";
};

type CompletionMap = Record<string, { completed: boolean; completedAt?: number }>;
type RecentByLevel = Record<CEFRLevel, string[]>;

type Settings = {
  preferredLevel: CEFRLevel;
  partnerMode: PartnerMode;
  mode: Mode;
  goalHours: number;
};

type SessionState = {
  templateId: string;
  phaseIndex: number;
  remainingSeconds: number;
  isRunning: boolean;
  showHelper: boolean;
  banner?: string;
  isFinished: boolean;
};

const APP_NAME = "FluentHour";
const APP_SUBTITLE = "Canadian benchmarks • calm structure";
const APP_TAGLINE =
  "Three hundred plus hours of guided speaking practice to level up your fluency. Set your goal, start at your level, and follow the steps with a language helper.";

const LEVELS: CEFRLevel[] = ["A1", "A2", "B1", "B2", "C1", "C2"];

const LEVEL_LABEL: Record<CEFRLevel, string> = {
  A1: "Beginner foundations",
  A2: "Everyday survival",
  B1: "Independent speaker",
  B2: "Confident and flexible",
  C1: "Professional precision",
  C2: "Near-native range",
};

const DEFAULT_CATEGORY: Category = "Everyday";

const LS_SETTINGS = "fluentHour.settings.v2";
const LS_RECENTS = "fluentHour.recents.v1";
const LS_COMPLETIONS = "fluentHour.completions.v1";
const LS_TIME = "fluentHour.time.v1";
const LS_IMPORTS = "fluentHour.imports.v1";

/* ----------------- helpers ----------------- */

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function safeJsonParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function usePersistedState<T>(key: string, fallback: T) {
  const [value, setValue] = useState<T>(() => safeJsonParse(localStorage.getItem(key), fallback));
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // ignore
    }
  }, [key, value]);
  return [value, setValue] as const;
}

function emptyRecents(): RecentByLevel {
  return { A1: [], A2: [], B1: [], B2: [], C1: [], C2: [] };
}

function formatMMSS(totalSeconds: number) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

function hoursString(seconds: number) {
  const hrs = seconds / 3600;
  const rounded = Math.round(hrs * 10) / 10;
  return `${rounded}`;
}

function normalizeId(id: string) {
  return id.trim().toLowerCase();
}

function stableHash(input: string) {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

function extractLevel(s: string): CEFRLevel | null {
  const m = s.match(/\b(A1|A2|B1|B2|C1|C2)\b/i);
  if (!m) return null;
  return m[1].toUpperCase() as CEFRLevel;
}

function parseMinutes(raw: string): number {
  const m = raw.match(/(\d+)\s*(?:min|mins|minutes|m)\b/i);
  if (m) return clamp(parseInt(m[1], 10), 1, 90);
  const num = parseInt(raw.trim(), 10);
  if (Number.isFinite(num)) return clamp(num, 1, 90);
  return 10;
}

function numberFromId(id: string): number | null {
  const m = id.match(/(\d{1,6})\s*$/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

/* ----------------- library fetch ----------------- */

function useLibraryText() {
  const [state, setState] = useState<{ loading: boolean; error?: string; text?: string }>({
    loading: true,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/library/perfect-hour-data.txt", { cache: "no-store" });
        if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
        const text = await res.text();
        const head = text.slice(0, 200).toLowerCase();
        if (head.includes("<!doctype html") || head.includes("<html")) {
          throw new Error(
            "Loaded HTML instead of the library file. Put perfect-hour-data.txt in public/library/ so it serves at /library/perfect-hour-data.txt."
          );
        }
        if (!cancelled) setState({ loading: false, text });
      } catch (e: any) {
        if (!cancelled) setState({ loading: false, error: e?.message || String(e) });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

/* ----------------- parser ----------------- */

function extractBlocks(raw: string): string[] {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const blocks: string[] = [];
  let collecting = false;
  let buf: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "BEGIN PERFECT HOUR SESSION") {
      collecting = true;
      buf = [trimmed];
      continue;
    }
    if (trimmed === "END PERFECT HOUR SESSION") {
      if (collecting) {
        buf.push(trimmed);
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

function normalizeCategory(raw: string): Category {
  const s = (raw || "").trim();
  if (!s) return DEFAULT_CATEGORY;
  const normalized = s.toLowerCase();

  const map: Array<[RegExp, Category]> = [
    [/travel|transit|bus|train|taxi|airport/, "Travel & Transit"],
    [/food|restaurant|order|cafe|coffee|menu/, "Food & Ordering"],
    [/housing|home|rent|shop|errand|store|market/, "Housing & Errands"],
    [/work|job|meeting|office|professional/, "Work & Professional"],
    [/friend|relationship|date|party|social/, "Social & Relationships"],
    [/health|doctor|hospital|emergency|medicine/, "Health & Emergencies"],
    [/culture|polite|manners|respect/, "Culture & Politeness"],
    [/problem|repair|fix|help|lost|broken/, "Problem Solving"],
    [/paperwork|admin|form|bank|government/, "Paperwork & Admin"],
    [/family|kid|child|school|parent/, "Family & Kids"],
    [/spiritual|ministry|church|faith|prayer/, "Spiritual & Ministry"],
  ];

  for (const [rx, cat] of map) {
    if (rx.test(normalized)) return cat;
  }

  const direct: Record<string, Category> = {
    "travel & transit": "Travel & Transit",
    "food & ordering": "Food & Ordering",
    "housing & errands": "Housing & Errands",
    "work & professional": "Work & Professional",
    "social & relationships": "Social & Relationships",
    "health & emergencies": "Health & Emergencies",
    "culture & politeness": "Culture & Politeness",
    "problem solving": "Problem Solving",
    "paperwork & admin": "Paperwork & Admin",
    "family & kids": "Family & Kids",
    "spiritual & ministry": "Spiritual & Ministry",
    "other": "Other",
    "everyday": "Everyday",
  };

  return direct[normalized] || DEFAULT_CATEGORY;
}

function parseTemplateBlock(block: string, source: "library" | "import"): Template | null {
  const lines = block.replace(/\r\n/g, "\n").split("\n");
  const getAfter = (prefix: string) => {
    const hit = lines.find((l) => l.trim().toLowerCase().startsWith(prefix.toLowerCase()));
    if (!hit) return "";
    return hit.split(":").slice(1).join(":").trim();
  };

  const rawTitle = getAfter("Title");
  const rawLevel = getAfter("Level");
  const rawId = getAfter("ID");
  const rawPartner = getAfter("Partner");
  const rawGoal = getAfter("Goal (CLB)");
  const rawContext = getAfter("Context");
  const rawCorrection = getAfter("Correction");
  const rawCategory = getAfter("Category");

  const level = extractLevel(rawLevel || lines.join(" ")) || null;
  if (!rawTitle || !level) return null;

  let partner: Template["partner"] = "either";
  const p = rawPartner.toLowerCase();
  if (p.includes("human") && p.includes("ai")) partner = "either";
  else if (p.includes("human")) partner = "human";
  else if (p.includes("ai")) partner = "ai";

  const category = normalizeCategory(rawCategory);

  const context = rawContext || "";
  const baseIdInput = `${rawTitle}||${level}||${context}`;
  const id = normalizeId(rawId || `${level}-${stableHash(baseIdInput)}`);

  const phases: Phase[] = [];
  const twists: string[] = [];

  let current: Partial<Phase> | null = null;
  let readingSteps = false;
  let readingHelper = false;
  let readingTwists = false;
  let helperBuf: string[] = [];
  let stepsBuf: string[] = [];

  const finalizePhase = () => {
    if (!current) return;
    const title = (current.title || "").trim();
    if (!title) return;

    const minutes = clamp(current.minutes ?? 10, 1, 90);
    const purpose = (current.purpose || "").trim();
    const helperScript = helperBuf.join("\n").trim();
    const learnerSteps = stepsBuf.map((s) => s.trim()).filter(Boolean);

    const phaseId = normalizeId(
      current.id ||
        `${id}::phase-${phases.length + 1}-${stableHash(`${title}|${minutes}|${purpose}|${helperScript}`)}`
    );

    phases.push({
      id: phaseId,
      title,
      minutes,
      purpose,
      learnerSteps,
      helperScript,
    });

    current = null;
    readingSteps = false;
    readingHelper = false;
    helperBuf = [];
    stepsBuf = [];
  };

  const isPhaseLine = (s: string) => s.trim().toUpperCase().startsWith("PHASE");
  const isTwistsLine = (s: string) => s.trim().toLowerCase().startsWith("twists");

  for (const line of lines) {
    const t = line.trim();

    if (t === "BEGIN PERFECT HOUR SESSION" || t === "END PERFECT HOUR SESSION") continue;

    if (isPhaseLine(line)) {
      finalizePhase();
      readingTwists = false;
      current = {};
      const after = line.split(":").slice(1).join(":").trim();
      if (after) {
        const namePart = after.replace(/\((.*?)\)/g, "").trim();
        if (namePart) current.title = namePart;
        const mm = after.match(/\(([^)]*)\)/);
        if (mm) current.minutes = parseMinutes(mm[1]);
      }
      continue;
    }

    if (isTwistsLine(line)) {
      finalizePhase();
      readingTwists = true;
      readingSteps = false;
      readingHelper = false;
      continue;
    }

    if (readingTwists) {
      if (t.startsWith("*")) {
        const item = t.replace(/^\*\s*/, "").trim();
        if (item) twists.push(item);
      }
      continue;
    }

    if (!current) continue;

    const lower = t.toLowerCase();

    if (lower.startsWith("name:")) {
      current.title = t.split(":").slice(1).join(":").trim();
      continue;
    }
    if (lower.startsWith("minutes:")) {
      current.minutes = parseMinutes(t.split(":").slice(1).join(":").trim());
      continue;
    }
    if (lower.startsWith("purpose:")) {
      current.purpose = t.split(":").slice(1).join(":").trim();
      continue;
    }
    if (lower.startsWith("human steps:")) {
      readingSteps = true;
      readingHelper = false;
      continue;
    }
    if (lower.startsWith("ai helper script:")) {
      readingHelper = true;
      readingSteps = false;
      const rest = t.split(":").slice(1).join(":").trim();
      if (rest) helperBuf.push(rest);
      continue;
    }

    if (readingSteps) {
      if (t.startsWith("*")) {
        stepsBuf.push(t.replace(/^\*\s*/, ""));
      }
      continue;
    }

    if (readingHelper) {
      if (t) helperBuf.push(line.trim());
      continue;
    }
  }

  finalizePhase();

  if (!phases.length) return null;

  return {
    id,
    title: rawTitle.trim(),
    level,
    partner,
    goalCLB: rawGoal || undefined,
    context: context || "",
    correction: rawCorrection || undefined,
    category,
    phases,
    twists,
    source,
  };
}

function parseImportedText(raw: string): Template[] {
  const blocks = extractBlocks(raw);
  const out: Template[] = [];
  for (const b of blocks) {
    const t = parseTemplateBlock(b, "import");
    if (t) out.push(t);
  }
  return out;
}

/* ----------------- UI primitives ----------------- */

function Card(props: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
        background: "var(--card)",
        boxShadow: "var(--shadow)",
        padding: 14,
        ...props.style,
      }}
    >
      {props.children}
    </div>
  );
}

function Button(props: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: "primary" | "soft" | "ghost";
  disabled?: boolean;
  full?: boolean;
  style?: React.CSSProperties;
}) {
  const variant = props.variant || "soft";
  const base: React.CSSProperties = {
    borderRadius: 999,
    padding: "12px 14px",
    border: "1px solid var(--border)",
    background: "rgba(15, 23, 42, 0.04)",
    color: "var(--text)",
    fontWeight: 900,
    letterSpacing: "-0.01em",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    minHeight: 44,
    width: props.full ? "100%" : undefined,
    opacity: props.disabled ? 0.55 : 1,
    cursor: props.disabled ? "not-allowed" : "pointer",
    ...props.style,
  };

  if (variant === "primary") {
    base.background =
      "linear-gradient(180deg, rgba(37,99,235,0.95), rgba(37,99,235,0.86))";
    base.border = "1px solid rgba(37, 99, 235, 0.35)";
    base.color = "#fff";
    base.boxShadow = "var(--shadow-sm)";
  }
  if (variant === "ghost") {
    base.background = "transparent";
    base.border = "1px solid transparent";
  }

  return (
    <button onClick={props.disabled ? undefined : props.onClick} style={base}>
      {props.children}
    </button>
  );
}

function Pill(props: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 10px",
        borderRadius: 999,
        border: "1px solid var(--border)",
        background: "rgba(15, 23, 42, 0.03)",
        color: "var(--muted)",
        fontWeight: 800,
        fontSize: 12,
        ...props.style,
      }}
    >
      {props.children}
    </span>
  );
}

function Divider() {
  return <div style={{ height: 1, background: "var(--border)", margin: "12px 0" }} />;
}

function Collapse(props: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(!!props.defaultOpen);
  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%",
          textAlign: "left",
          borderRadius: 12,
          padding: "10px 12px",
          border: "1px solid var(--border)",
          background: "rgba(15, 23, 42, 0.02)",
          fontWeight: 900,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
        }}
      >
        <span>{props.title}</span>
        <span style={{ color: "var(--muted)", fontWeight: 900 }}>{open ? "–" : "+"}</span>
      </button>
      {open ? <div style={{ marginTop: 10 }}>{props.children}</div> : null}
    </div>
  );
}

function Sheet(props: { open: boolean; title: string; onClose: () => void; children: React.ReactNode }) {
  if (!props.open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 999,
        background: "rgba(15,23,42,0.40)",
        backdropFilter: "blur(6px)",
        display: "flex",
        justifyContent: "flex-end",
      }}
      onMouseDown={props.onClose}
    >
      <div
        style={{
          width: "min(520px, 92vw)",
          height: "100%",
          background: "rgba(255,255,255,0.88)",
          borderLeft: "1px solid rgba(15,23,42,0.12)",
          boxShadow: "0 30px 90px rgba(15,23,42,0.22)",
          padding: 14,
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div style={{ fontWeight: 980, fontSize: 16, letterSpacing: "-0.02em" }}>{props.title}</div>
          <Button variant="ghost" onClick={props.onClose}>
            Close
          </Button>
        </div>
        <div style={{ marginTop: 12 }}>{props.children}</div>
      </div>
    </div>
  );
}

function MenuButton(props: { label: string; value: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          borderRadius: 999,
          padding: "10px 12px",
          border: "1px solid rgba(255,255,255,0.22)",
          background:
            "linear-gradient(180deg, rgba(255,255,255,0.18), rgba(255,255,255,0.10))",
          color: "rgba(255,255,255,0.92)",
          fontWeight: 900,
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          minHeight: 40,
          boxShadow: "0 6px 18px rgba(15,23,42,0.10)",
        }}
      >
        <span style={{ opacity: 0.9 }}>{props.label}:</span>
        <span>{props.value}</span>
        <span style={{ opacity: 0.75 }}>▾</span>
      </button>

      {open ? (
        <div
          style={{
            position: "absolute",
            right: 0,
            top: 46,
            width: 280,
            borderRadius: 14,
            background: "rgba(255,255,255,0.92)",
            border: "1px solid rgba(15,23,42,0.12)",
            boxShadow: "0 24px 70px rgba(15,23,42,0.18)",
            overflow: "hidden",
            zIndex: 20,
          }}
        >
          <div style={{ padding: 10 }} onClick={() => setOpen(false)}>
            {props.children}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MenuItem(props: { title: string; subtitle?: string; onClick: () => void }) {
  return (
    <button
      onClick={props.onClick}
      style={{
        width: "100%",
        textAlign: "left",
        borderRadius: 12,
        padding: "10px 10px",
        border: "1px solid transparent",
        background: "transparent",
        cursor: "pointer",
      }}
    >
      <div style={{ fontWeight: 950, letterSpacing: "-0.01em" }}>{props.title}</div>
      {props.subtitle ? <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 2 }}>{props.subtitle}</div> : null}
    </button>
  );
}

/* ----------------- Error boundary ----------------- */

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean; message?: string }> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError(err: any) {
    return { hasError: true, message: err?.message || String(err) };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ maxWidth: 900, margin: "0 auto", padding: 18 }}>
          <Card>
            <div style={{ fontWeight: 980, fontSize: 18 }}>Something went wrong</div>
            <div style={{ color: "var(--muted)", marginTop: 8 }}>{this.state.message}</div>
          </Card>
        </div>
      );
    }
    return this.props.children;
  }
}

/* ----------------- App ----------------- */

export default function App() {
  const lib = useLibraryText();

  const [settings, setSettings] = usePersistedState<Settings>(LS_SETTINGS, {
    preferredLevel: "A2",
    partnerMode: "human",
    mode: "random",
    goalHours: 300,
  });

  const [recents, setRecents] = usePersistedState<RecentByLevel>(LS_RECENTS, emptyRecents());
  const [completions, setCompletions] = usePersistedState<CompletionMap>(LS_COMPLETIONS, {});
  const [time, setTime] = usePersistedState<{ totalSeconds: number; goalHours: number }>(LS_TIME, {
    totalSeconds: 0,
    goalHours: 300,
  });

  useEffect(() => {
    if (time.goalHours !== settings.goalHours) setTime((t) => ({ ...t, goalHours: settings.goalHours }));
  }, [settings.goalHours]); // intentionally only track goalHours

  const [imports, setImports] = usePersistedState<Template[]>(LS_IMPORTS, []);

  const [screen, setScreen] = useState<Screen>("home");
  const [session, setSession] = useState<SessionState | null>(null);
  const [sheetLevel, setSheetLevel] = useState<CEFRLevel | null>(null);

  const libraryTemplates = useMemo(() => {
    if (!lib.text) return [];
    const blocks = extractBlocks(lib.text);
    const out: Template[] = [];
    for (const b of blocks) {
      const t = parseTemplateBlock(b, "library");
      if (t) out.push(t);
    }
    return out;
  }, [lib.text]);

  const allTemplates = useMemo(() => {
    const m = new Map<string, Template>();
    for (const t of libraryTemplates) m.set(t.id, t);
    for (const t of imports) m.set(t.id, t);
    return Array.from(m.values());
  }, [libraryTemplates, imports]);

  const templatesByLevel = useMemo(() => {
    const map: Record<CEFRLevel, Template[]> = { A1: [], A2: [], B1: [], B2: [], C1: [], C2: [] };
    for (const t of allTemplates) map[t.level].push(t);

    for (const l of LEVELS) {
      map[l].sort((a, b) => {
        const an = numberFromId(a.id);
        const bn = numberFromId(b.id);
        if (an != null && bn != null) return an - bn;
        return a.title.localeCompare(b.title);
      });
    }
    return map;
  }, [allTemplates]);

  const coverageByLevel = useMemo(() => {
    const cov: Record<CEFRLevel, { done: number; total: number; pct: number }> = {
      A1: { done: 0, total: 0, pct: 0 },
      A2: { done: 0, total: 0, pct: 0 },
      B1: { done: 0, total: 0, pct: 0 },
      B2: { done: 0, total: 0, pct: 0 },
      C1: { done: 0, total: 0, pct: 0 },
      C2: { done: 0, total: 0, pct: 0 },
    };

    for (const level of LEVELS) {
      const list = templatesByLevel[level];
      const total = list.length;
      const done = list.reduce((acc, t) => acc + (completions[t.id]?.completed ? 1 : 0), 0);
      const pct = total ? Math.round((done / total) * 100) : 0;
      cov[level] = { done, total, pct };
    }
    return cov;
  }, [templatesByLevel, completions]);

  function pushRecent(level: CEFRLevel, id: string) {
    setRecents((prev) => {
      const cur = prev[level] ?? [];
      const next = [id, ...cur.filter((x) => x !== id)].slice(0, 6);
      return { ...prev, [level]: next };
    });
  }

  function pickRandom(level: CEFRLevel): Template | null {
    const list = templatesByLevel[level];
    if (!list.length) return null;
    const avoid = new Set((recents[level] ?? []).slice(0, 6));
    const pool = list.filter((t) => !avoid.has(t.id));
    const pickFrom = pool.length ? pool : list;
    const idx = Math.floor(Math.random() * pickFrom.length);
    return pickFrom[idx] || pickFrom[0] || null;
  }

  function pickNextInPath(level: CEFRLevel): Template | null {
    const list = templatesByLevel[level];
    if (!list.length) return null;
    return list.find((t) => !completions[t.id]?.completed) || null;
  }

  function startTemplate(t: Template) {
    pushRecent(t.level, t.id);
    const first = t.phases[0];
    setSession({
      templateId: t.id,
      phaseIndex: 0,
      remainingSeconds: clamp(first.minutes, 1, 90) * 60,
      isRunning: false,
      showHelper: false,
      banner: undefined,
      isFinished: false,
    });
    setScreen("session");
  }

  function startFromHome() {
    const level = settings.preferredLevel;
    const choice = settings.mode === "path" ? pickNextInPath(level) || pickRandom(level) : pickRandom(level);
    if (choice) startTemplate(choice);
  }

  function toggleCompletion(templateId: string, completed: boolean) {
    setCompletions((prev) => {
      const next: CompletionMap = { ...prev };
      next[templateId] = completed ? { completed: true, completedAt: Date.now() } : { completed: false };
      return next;
    });
  }

  const tickRef = useRef<number | null>(null);
  useEffect(() => {
    if (!session?.isRunning) {
      if (tickRef.current) window.clearInterval(tickRef.current);
      tickRef.current = null;
      return;
    }

    if (tickRef.current) window.clearInterval(tickRef.current);

    tickRef.current = window.setInterval(() => {
      setSession((prev) => {
        if (!prev || !prev.isRunning) return prev;

        setTime((t) => ({ ...t, totalSeconds: t.totalSeconds + 1 }));

        const nextRemaining = prev.remainingSeconds - 1;
        if (nextRemaining > 0) return { ...prev, remainingSeconds: nextRemaining };

        const tmpl = allTemplates.find((x) => x.id === prev.templateId) || null;
        if (!tmpl) return { ...prev, remainingSeconds: 0, isRunning: false, showHelper: false };

        const atEnd = prev.phaseIndex >= tmpl.phases.length - 1;
        if (atEnd) {
          return {
            ...prev,
            remainingSeconds: 0,
            isRunning: false,
            showHelper: false,
            banner: "Session complete",
            isFinished: true,
          };
        }

        const nextIndex = prev.phaseIndex + 1;
        const nextPhase = tmpl.phases[nextIndex];
        return {
          ...prev,
          phaseIndex: nextIndex,
          remainingSeconds: clamp(nextPhase.minutes, 1, 90) * 60,
          isRunning: false,
          showHelper: false,
          banner: "Phase complete",
        };
      });
    }, 1000);

    return () => {
      if (tickRef.current) window.clearInterval(tickRef.current);
      tickRef.current = null;
    };
  }, [session?.isRunning, allTemplates, setTime]);

  const activeTemplate = useMemo(() => {
    if (!session) return null;
    return allTemplates.find((t) => t.id === session.templateId) || null;
  }, [session, allTemplates]);

  const [importLevel, setImportLevel] = useState<CEFRLevel>(settings.preferredLevel);
  const [importCategory, setImportCategory] = useState<Category>("Everyday");
  const [importPartner, setImportPartner] = useState<Template["partner"]>("either");
  const [importContext, setImportContext] = useState("");
  const [importPaste, setImportPaste] = useState("");
  const [importMsg, setImportMsg] = useState<string | null>(null);

  function buildImportPrompt() {
    const level = importLevel;
    const cat = importCategory;
    const partner = importPartner;
    const extra = importContext.trim() ? `\nExtra context for cultural fit:\n- ${importContext.trim()}` : "";

    return `Create ONE "FluentHour" PERFECT HOUR SESSION in this exact plain-text format.

Requirements:
- Use these markers on their own lines:
  BEGIN PERFECT HOUR SESSION
  END PERFECT HOUR SESSION
- Level: ${level}
- Category: ${cat}
- Partner: ${partner === "either" ? "Human or AI" : partner === "human" ? "Human" : "AI"}
- Four phases. Total minutes must equal 60.
- Each phase must include:
  Name:
  Minutes:
  Purpose:
  Human steps: (bullet list using "* ")
  AI helper script:
- Include:
  Goal (CLB):
  Context:
  Correction:
  Twists: (bullet list using "* ")
${extra}

Output ONLY the session text.`;
  }

  function copyText(text: string) {
    navigator.clipboard?.writeText(text).catch(() => {});
  }

  function doImport() {
    setImportMsg(null);
    const incoming = parseImportedText(importPaste);
    if (!incoming.length) {
      setImportMsg("No valid sessions found. Make sure markers exist and format matches.");
      return;
    }

    setImports((prev) => {
      const map = new Map<string, Template>();
      for (const t of prev) map.set(t.id, t);
      for (const t of incoming) map.set(t.id, t);
      return Array.from(map.values());
    });

    setImportPaste("");
    setImportMsg(`Imported ${incoming.length} session${incoming.length === 1 ? "" : "s"}.`);
  }

  const headerStyle: React.CSSProperties = {
    padding: 14,
    position: "sticky",
    top: 12,
    zIndex: 10,
    borderRadius: "var(--radius)",
    border: "1px solid rgba(255,255,255,0.18)",
    background:
      "radial-gradient(900px 220px at 20% -60%, rgba(37,99,235,0.40), transparent 60%)," +
      "radial-gradient(900px 240px at 110% 0%, rgba(15,23,42,0.18), transparent 62%)," +
      "linear-gradient(180deg, rgba(15,23,42,0.62), rgba(15,23,42,0.44))",
    boxShadow: "0 18px 60px rgba(15,23,42,0.24)",
    color: "rgba(255,255,255,0.96)",
    backdropFilter: "blur(14px)",
  };

  const topContainerStyle: React.CSSProperties = { maxWidth: 980, margin: "0 auto", padding: "18px 14px 40px" };

  const totalPct = clamp((time.totalSeconds / 3600 / Math.max(1, settings.goalHours)) * 100, 0, 100);

  return (
    <ErrorBoundary>
      <div style={topContainerStyle}>
        <div style={headerStyle}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div style={{ display: "grid", gap: 4 }}>
              <div style={{ fontWeight: 990, letterSpacing: "-0.03em", fontSize: 16 }}>{APP_NAME}</div>
              <div style={{ opacity: 0.86, fontSize: 13 }}>{APP_SUBTITLE}</div>
            </div>

            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              {screen === "session" ? (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setSession(null);
                    setScreen("home");
                  }}
                  style={{ color: "rgba(255,255,255,0.92)" }}
                >
                  Home
                </Button>
              ) : (
                <>
                  <MenuButton label="Level" value={settings.preferredLevel}>
                    {LEVELS.map((lvl) => (
                      <MenuItem
                        key={lvl}
                        title={`${lvl} — ${LEVEL_LABEL[lvl]}`}
                        subtitle={`${coverageByLevel[lvl].done} of ${coverageByLevel[lvl].total} completed`}
                        onClick={() => setSettings((s) => ({ ...s, preferredLevel: lvl }))}
                      />
                    ))}
                  </MenuButton>

                  <MenuButton label="Mode" value={settings.mode === "random" ? "Random" : "Path"}>
                    <MenuItem title="Random" subtitle="Fresh practice within your level" onClick={() => setSettings((s) => ({ ...s, mode: "random" }))} />
                    <MenuItem title="Path" subtitle="Next uncompleted session" onClick={() => setSettings((s) => ({ ...s, mode: "path" }))} />
                  </MenuButton>
                </>
              )}
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gap: 14, marginTop: 14 }}>
          {screen === "home" ? (
            <>
              <Card>
                <div style={{ fontWeight: 980, fontSize: 18, letterSpacing: "-0.02em" }}>Start at your level.</div>
                <div style={{ color: "var(--muted)", marginTop: 6, lineHeight: 1.35 }}>{APP_TAGLINE}</div>

                <Divider />

                <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                  <div style={{ fontWeight: 980, fontSize: 28, letterSpacing: "-0.02em" }}>{hoursString(time.totalSeconds)}</div>
                  <div style={{ color: "var(--muted)", fontWeight: 900 }}>hours of {settings.goalHours} hours</div>
                  <Pill style={{ marginLeft: "auto" }}>{Math.round(totalPct)}%</Pill>
                </div>

                <div
                  style={{
                    marginTop: 10,
                    height: 10,
                    borderRadius: 999,
                    border: "1px solid var(--border)",
                    background: "rgba(15, 23, 42, 0.03)",
                    overflow: "hidden",
                    boxShadow: "var(--shadow-sm)",
                  }}
                >
                  <div style={{ height: "100%", width: `${Math.round(totalPct)}%`, background: "rgba(37, 99, 235, 0.26)" }} />
                </div>

                <div style={{ height: 12 }} />

                <Button
                  variant="primary"
                  onClick={startFromHome}
                  disabled={lib.loading || !!lib.error || templatesByLevel[settings.preferredLevel].length === 0}
                  full
                >
                  Start my fluent hour
                </Button>

                {lib.error ? (
                  <div style={{ marginTop: 12, color: "rgba(220, 38, 38, 0.92)" }}>
                    <strong>Library issue:</strong> {lib.error}
                  </div>
                ) : null}

                {lib.loading ? <div style={{ marginTop: 10, color: "var(--muted)" }}>Loading library…</div> : null}

                <Divider />

                <div style={{ display: "grid", gap: 8 }}>
                  <div style={{ fontWeight: 950, letterSpacing: "-0.01em" }}>Levels</div>
                  <div style={{ display: "grid", gap: 8 }}>
                    {LEVELS.map((lvl) => {
                      const cov = coverageByLevel[lvl];
                      const selected = settings.preferredLevel === lvl;
                      return (
                        <button
                          key={lvl}
                          onClick={() => setSheetLevel(lvl)}
                          style={{
                            textAlign: "left",
                            borderRadius: 16,
                            padding: "12px 12px",
                            border: selected ? "1px solid rgba(37, 99, 235, 0.30)" : "1px solid var(--border)",
                            background: selected
                              ? "linear-gradient(180deg, rgba(37,99,235,0.10), rgba(37,99,235,0.05))"
                              : "rgba(15,23,42,0.02)",
                            boxShadow: "var(--shadow-sm)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 12,
                            cursor: "pointer",
                          }}
                        >
                          <div style={{ display: "grid", gap: 3 }}>
                            <div style={{ fontWeight: 980, letterSpacing: "-0.01em" }}>
                              {lvl} <span style={{ color: "var(--muted)", fontWeight: 900 }}>— {LEVEL_LABEL[lvl]}</span>
                            </div>
                            <div style={{ color: "var(--muted)", fontSize: 13 }}>
                              {cov.done} of {cov.total} completed
                            </div>
                          </div>

                          <Pill>{cov.pct}%</Pill>
                        </button>
                      );
                    })}
                  </div>

                  <div style={{ color: "var(--muted)", fontSize: 13 }}>Tip: repeats still count toward hours.</div>
                </div>

                <div style={{ height: 12 }} />

                <Collapse title="Advanced" defaultOpen={false}>
                  <div style={{ display: "grid", gap: 12 }}>
                    <Card style={{ boxShadow: "var(--shadow-sm)", background: "rgba(15,23,42,0.02)" }}>
                      <div style={{ fontWeight: 950 }}>Goal and partner</div>
                      <div style={{ height: 10 }} />
                      <label style={{ display: "grid", gap: 6 }}>
                        <div style={{ color: "var(--muted)", fontWeight: 900 }}>Hours goal</div>
                        <input
                          type="number"
                          min={10}
                          max={5000}
                          value={settings.goalHours}
                          onChange={(e) =>
                            setSettings((s) => ({
                              ...s,
                              goalHours: clamp(parseInt(e.target.value || "300", 10), 10, 5000),
                            }))
                          }
                        />
                      </label>

                      <div style={{ height: 10 }} />

                      <label style={{ display: "grid", gap: 6 }}>
                        <div style={{ color: "var(--muted)", fontWeight: 900 }}>Partner mode</div>
                        <select
                          value={settings.partnerMode}
                          onChange={(e) => setSettings((s) => ({ ...s, partnerMode: e.target.value as PartnerMode }))}
                        >
                          <option value="human">Human helper (preferred)</option>
                          <option value="ai">AI helper (fallback)</option>
                        </select>
                      </label>
                    </Card>

                    <Card style={{ boxShadow: "var(--shadow-sm)", background: "rgba(15,23,42,0.02)" }}>
                      <div style={{ fontWeight: 950 }}>Import (Advanced)</div>
                      <div style={{ color: "var(--muted)", marginTop: 6 }}>Generate a session with an AI, then paste it here.</div>

                      <div style={{ height: 10 }} />

                      <div style={{ display: "grid", gap: 10 }}>
                        <label style={{ display: "grid", gap: 6 }}>
                          <div style={{ color: "var(--muted)", fontWeight: 900 }}>Level</div>
                          <select value={importLevel} onChange={(e) => setImportLevel(e.target.value as CEFRLevel)}>
                            {LEVELS.map((l) => (
                              <option key={l} value={l}>
                                {l}
                              </option>
                            ))}
                          </select>
                        </label>

                        <label style={{ display: "grid", gap: 6 }}>
                          <div style={{ color: "var(--muted)", fontWeight: 900 }}>Focus category</div>
                          <select value={importCategory} onChange={(e) => setImportCategory(e.target.value as Category)}>
                            {[
                              "Everyday",
                              "Travel & Transit",
                              "Food & Ordering",
                              "Housing & Errands",
                              "Work & Professional",
                              "Social & Relationships",
                              "Health & Emergencies",
                              "Culture & Politeness",
                              "Problem Solving",
                              "Paperwork & Admin",
                              "Family & Kids",
                              "Spiritual & Ministry",
                              "Other",
                            ].map((c) => (
                              <option key={c} value={c}>
                                {c}
                              </option>
                            ))}
                          </select>
                        </label>

                        <label style={{ display: "grid", gap: 6 }}>
                          <div style={{ color: "var(--muted)", fontWeight: 900 }}>Partner</div>
                          <select value={importPartner} onChange={(e) => setImportPartner(e.target.value as Template["partner"])}>
                            <option value="either">Human or AI</option>
                            <option value="human">Human</option>
                            <option value="ai">AI</option>
                          </select>
                        </label>

                        <label style={{ display: "grid", gap: 6 }}>
                          <div style={{ color: "var(--muted)", fontWeight: 900 }}>Extra context (optional)</div>
                          <textarea value={importContext} onChange={(e) => setImportContext(e.target.value)} />
                        </label>

                        <Button
                          variant="soft"
                          onClick={() => {
                            copyText(buildImportPrompt());
                            setImportMsg("AI prompt copied.");
                          }}
                        >
                          Copy AI prompt
                        </Button>

                        <label style={{ display: "grid", gap: 6 }}>
                          <div style={{ color: "var(--muted)", fontWeight: 900 }}>Paste AI output</div>
                          <textarea value={importPaste} onChange={(e) => setImportPaste(e.target.value)} />
                        </label>

                        <Button variant="primary" onClick={doImport} disabled={!importPaste.trim()} full>
                          Import session
                        </Button>

                        {importMsg ? <div style={{ color: "var(--muted)" }}>{importMsg}</div> : null}
                      </div>
                    </Card>

                    <Card style={{ boxShadow: "var(--shadow-sm)", background: "rgba(15,23,42,0.02)" }}>
                      <div style={{ fontWeight: 950 }}>About</div>
                      <div style={{ color: "var(--muted)", marginTop: 6 }}>
                        You will improve with consistent, guided speaking practice. Choose a level and follow the steps with a helper.
                      </div>
                    </Card>
                  </div>
                </Collapse>
              </Card>

              <Sheet open={sheetLevel != null} title={sheetLevel ? `${sheetLevel} checklist` : "Checklist"} onClose={() => setSheetLevel(null)}>
                {sheetLevel ? (
                  <LevelChecklist
                    templates={templatesByLevel[sheetLevel]}
                    completions={completions}
                    onToggleComplete={(id, next) => toggleCompletion(id, next)}
                    onStart={(id) => {
                      const t = allTemplates.find((x) => x.id === id) || null;
                      if (t) startTemplate(t);
                      setSheetLevel(null);
                    }}
                  />
                ) : null}
              </Sheet>
            </>
          ) : (
            <SessionRunner
              template={activeTemplate}
              session={session}
              setSession={setSession}
              onMarkComplete={() => {
                if (!session) return;
                toggleCompletion(session.templateId, true);
              }}
              isCompleted={session ? !!completions[session.templateId]?.completed : false}
              partnerMode={settings.partnerMode}
              onCopy={copyText}
            />
          )}
        </div>
      </div>
    </ErrorBoundary>
  );
}

/* ----------------- Checklist ----------------- */

function LevelChecklist(props: {
  templates: Template[];
  completions: CompletionMap;
  onToggleComplete: (id: string, next: boolean) => void;
  onStart: (id: string) => void;
}) {
  const [filter, setFilter] = useState<"all" | "incomplete" | "complete">("incomplete");

  const rows = useMemo(() => {
    const items = props.templates.map((t) => ({
      t,
      done: !!props.completions[t.id]?.completed,
    }));

    items.sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1;
      return a.t.title.localeCompare(b.t.title);
    });

    if (filter === "all") return items;
    if (filter === "complete") return items.filter((x) => x.done);
    return items.filter((x) => !x.done);
  }, [props.templates, props.completions, filter]);

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Button variant={filter === "incomplete" ? "primary" : "soft"} onClick={() => setFilter("incomplete")}>
          Incomplete
        </Button>
        <Button variant={filter === "complete" ? "primary" : "soft"} onClick={() => setFilter("complete")}>
          Complete
        </Button>
        <Button variant={filter === "all" ? "primary" : "soft"} onClick={() => setFilter("all")}>
          All
        </Button>
      </div>

      <div style={{ display: "grid", gap: 8 }}>
        {rows.map(({ t, done }) => (
          <div
            key={t.id}
            role="button"
            tabIndex={0}
            onClick={() => props.onStart(t.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter") props.onStart(t.id);
            }}
            style={{
              display: "grid",
              gridTemplateColumns: "28px 1fr auto",
              gap: 10,
              alignItems: "center",
              border: "1px solid var(--border)",
              borderRadius: 14,
              padding: "10px 10px",
              background: "rgba(15,23,42,0.02)",
              boxShadow: "var(--shadow-sm)",
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={done}
              onChange={(e) => props.onToggleComplete(t.id, e.target.checked)}
              onClick={(e) => e.stopPropagation()}
              style={{ width: 18, height: 18 }}
              aria-label="Mark complete"
            />
            <div style={{ display: "grid", gap: 2 }}>
              <div style={{ fontWeight: 950, letterSpacing: "-0.01em" }}>{t.title}</div>
              <div style={{ color: "var(--muted)", fontSize: 12 }}>
                {t.category} • {t.partner === "either" ? "Human or AI" : t.partner === "human" ? "Human" : "AI"}
              </div>
            </div>
            <Pill>{done ? "Done" : "Start"}</Pill>
          </div>
        ))}

        {!rows.length ? <div style={{ color: "var(--muted)" }}>Nothing here yet.</div> : null}
      </div>
    </div>
  );
}

/* ----------------- Session Runner ----------------- */

function SessionRunner(props: {
  template: Template | null;
  session: SessionState | null;
  setSession: React.Dispatch<React.SetStateAction<SessionState | null>>;
  onMarkComplete: () => void;
  isCompleted: boolean;
  partnerMode: PartnerMode;
  onCopy: (text: string) => void;
}) {
  const s = props.session;
  const t = props.template;

  if (!s || !t) {
    return (
      <Card>
        <div style={{ fontWeight: 980, fontSize: 18 }}>Session</div>
        <div style={{ color: "var(--muted)", marginTop: 8 }}>No active session.</div>
      </Card>
    );
  }

  const phase = t.phases[s.phaseIndex] || t.phases[0];
  const phaseTotalSeconds = clamp(phase.minutes, 1, 90) * 60;
  const phaseProgress = phaseTotalSeconds ? 1 - s.remainingSeconds / phaseTotalSeconds : 0;

  useEffect(() => {
    if (s.isRunning && s.showHelper) {
      props.setSession((prev) => (prev ? { ...prev, showHelper: false } : prev));
    }
  }, [s.isRunning, s.showHelper, props]);

  function toggleRun() {
    props.setSession((prev) => (prev ? { ...prev, isRunning: !prev.isRunning, banner: undefined } : prev));
  }

  function skipToNext() {
    props.setSession((prev) => {
      if (!prev) return prev;
      const atEnd = prev.phaseIndex >= t.phases.length - 1;
      if (atEnd) {
        return { ...prev, isRunning: false, remainingSeconds: 0, showHelper: false, banner: "Session complete", isFinished: true };
      }
      const nextIndex = prev.phaseIndex + 1;
      const nextPhase = t.phases[nextIndex];
      return { ...prev, phaseIndex: nextIndex, remainingSeconds: clamp(nextPhase.minutes, 1, 90) * 60, isRunning: false, showHelper: false, banner: "Moved to next phase" };
    });
  }

  function toggleHelper() {
    props.setSession((prev) => (prev ? { ...prev, showHelper: !prev.showHelper } : prev));
  }

  const helperText = useMemo(() => {
    const partnerLine =
      props.partnerMode === "human"
        ? "You are my human language helper. Keep turns short and natural."
        : "You are my AI language helper. Keep turns short and natural.";
    return [
      partnerLine,
      `Level: ${t.level}`,
      `Session: ${t.title}`,
      `Context: ${t.context}`,
      t.goalCLB ? `Goal: ${t.goalCLB}` : "",
      t.correction ? `Correction focus: ${t.correction}` : "",
      "",
      `Phase: ${phase.title} (${phase.minutes} minutes)`,
      `Purpose: ${phase.purpose}`,
      "",
      "Learner steps:",
      ...phase.learnerSteps.map((x, i) => `${i + 1}. ${x}`),
      "",
      "Helper script:",
      phase.helperScript,
    ]
      .filter(Boolean)
      .join("\n");
  }, [t, phase, props.partnerMode]);

  return (
    <Card>
      <div style={{ fontWeight: 980, fontSize: 18, letterSpacing: "-0.02em" }}>Session</div>
      <div style={{ color: "var(--muted)", marginTop: 4 }}>
        {t.level} • {t.category} • Phase {s.phaseIndex + 1} of {t.phases.length}
      </div>

      <div style={{ height: 12 }} />

      <Card style={{ boxShadow: "var(--shadow-sm)", background: "rgba(37, 99, 235, 0.04)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontWeight: 980, fontSize: 34, letterSpacing: "-0.02em" }}>{formatMMSS(s.remainingSeconds)}</div>
            <div style={{ color: "var(--muted)", marginTop: 4 }}>{phase.title}</div>
          </div>

          <Button variant="primary" onClick={toggleRun}>
            {s.isRunning ? "Pause" : "Start"}
          </Button>
        </div>

        <div style={{ height: 10 }} />

        <div
          style={{
            height: 10,
            borderRadius: 999,
            border: "1px solid var(--border)",
            background: "rgba(15, 23, 42, 0.03)",
            overflow: "hidden",
            boxShadow: "var(--shadow-sm)",
          }}
        >
          <div style={{ height: "100%", width: `${Math.round(phaseProgress * 100)}%`, background: "rgba(37, 99, 235, 0.26)" }} />
        </div>

        {s.banner ? <div style={{ marginTop: 10, color: "var(--muted)", fontWeight: 900 }}>{s.banner}</div> : null}
      </Card>

      <div style={{ height: 12 }} />

      <Card style={{ boxShadow: "var(--shadow-sm)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ fontWeight: 950 }}>Learner</div>
          <Pill>{s.isRunning ? "Running" : "Paused"}</Pill>
        </div>

        <div style={{ marginTop: 10, color: "var(--muted)" }}>
          <strong>Situation:</strong> {t.title}. {t.context}
        </div>

        {t.goalCLB || t.correction ? (
          <div style={{ marginTop: 10, display: "grid", gap: 8, color: "var(--muted)" }}>
            {t.goalCLB ? (
              <div>
                <strong>Goal:</strong> {t.goalCLB}
              </div>
            ) : null}
            {t.correction ? (
              <div>
                <strong>Correction focus:</strong> {t.correction}
              </div>
            ) : null}
          </div>
        ) : null}

        <div style={{ marginTop: 10, color: "var(--muted)" }}>{phase.purpose}</div>

        <ul style={{ margin: 0, marginTop: 10, paddingLeft: 18, color: "var(--muted)", display: "grid", gap: 8 }}>
          {phase.learnerSteps.map((step, idx) => (
            <li key={idx}>{step}</li>
          ))}
        </ul>
      </Card>

      <div style={{ height: 12 }} />

      {s.isFinished ? (
        <Card style={{ boxShadow: "var(--shadow-sm)", background: "rgba(16,185,129,0.06)" }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
            <div style={{ fontWeight: 950 }}>{props.isCompleted ? "Completed" : "Session ended"}</div>
            {!props.isCompleted ? (
              <Button variant="primary" onClick={props.onMarkComplete}>
                Mark complete
              </Button>
            ) : (
              <Pill>Saved</Pill>
            )}
          </div>
        </Card>
      ) : null}

      <div style={{ height: 12 }} />

      <Collapse title="Advanced" defaultOpen={false}>
        <div style={{ display: "grid", gap: 12 }}>
          <Card style={{ boxShadow: "var(--shadow-sm)", background: "rgba(15,23,42,0.02)" }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Button variant="soft" onClick={skipToNext}>
                Skip to next
              </Button>
              <Button variant="soft" onClick={toggleHelper} disabled={s.isRunning}>
                {s.showHelper ? "Hide helper" : "Show helper"}
              </Button>
              <Button variant="soft" onClick={() => props.onCopy(helperText)} disabled={s.isRunning}>
                Copy helper prompt
              </Button>
            </div>

            {s.showHelper && !s.isRunning ? (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontWeight: 950 }}>Helper</div>
                <div style={{ color: "var(--muted)", marginTop: 6 }}>Paste this into your helper/AI. Keep turns short.</div>
                <pre
                  style={{
                    marginTop: 10,
                    padding: 12,
                    borderRadius: 14,
                    border: "1px solid var(--border)",
                    background: "rgba(255,255,255,0.7)",
                    overflowX: "auto",
                    whiteSpace: "pre-wrap",
                    color: "rgba(15,23,42,0.82)",
                    boxShadow: "var(--shadow-sm)",
                  }}
                >
                  {helperText}
                </pre>
              </div>
            ) : null}
          </Card>

          <Card style={{ boxShadow: "var(--shadow-sm)", background: "rgba(15,23,42,0.02)" }}>
            <div style={{ fontWeight: 950 }}>Localize for your context</div>
            <div style={{ color: "var(--muted)", marginTop: 6 }}>Keep the purpose. Adjust the social rules.</div>
            <ul style={{ margin: 0, marginTop: 10, paddingLeft: 18, color: "var(--muted)", display: "grid", gap: 8 }}>
              <li>Istanbul: polite forms + tighter personal space in crowds.</li>
              <li>Paris: quicker turn-taking; softer apologies; short confirmations.</li>
              <li>PNG villages: names, kin terms, and respect cues matter more than speed.</li>
              <li>Oman: modest tone; indirect requests; high respect for elders.</li>
            </ul>
          </Card>
        </div>
      </Collapse>
    </Card>
  );
}
