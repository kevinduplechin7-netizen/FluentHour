// src/App.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";

const APP_NAME = "FluentHour";
const APP_SUBTITLE = "Guided speaking practice • local-first";
const APP_TAGLINE =
  "Three hundred plus hours of guided speaking practice to level up your fluency. Set your goal, start at your level, and follow the steps with a language helper.";


/**
 * FluentHour
 * Vite + React + TypeScript, local-first.
 *
 * Two screens only:
 * - Home: "Start my fluent hour"
 * - Session: "Start / Pause" (autopause at phase end)
 *
 * Library:
 * - perfect-hour-data.txt must be available at /library/perfect-hour-data.txt (recommended: public/library/)
 * - Sessions are extracted only from BEGIN/END blocks (notes between sessions are ignored)
 *
 * Local storage:
 * - preferred level, partner mode, category bias, home mode
 * - recent template IDs per level (variety)
 * - completion (coverage) per template ID
 * - time tracking toward a goal
 */

type Screen = "home" | "session";
type PartnerMode = "human" | "ai";
type HomeMode = "random" | "path";
type CEFRLevel = "A1" | "A2" | "B1" | "B2" | "C1" | "C2";

const CEFR_LEVELS: CEFRLevel[] = ["A1", "A2", "B1", "B2", "C1", "C2"];

const LEVEL_EQUIV: Record<CEFRLevel, { actfl: string; clb: string; label: string }> = {
  A1: { actfl: "Novice Low–Mid", clb: "CLB 1–2", label: "Beginner foundations" },
  A2: { actfl: "Novice High–Intermediate Low", clb: "CLB 3–4", label: "Everyday survival" },
  B1: { actfl: "Intermediate Mid–High", clb: "CLB 5–6", label: "Independent speaker" },
  B2: { actfl: "Advanced Low–Mid", clb: "CLB 7–8", label: "Confident and flexible" },
  C1: { actfl: "Advanced Mid–Superior", clb: "CLB 9–10", label: "Professional precision" },
  C2: { actfl: "Superior–Distinguished", clb: "CLB 11–12", label: "Near-native range" },
};

type Category =
  | "Daily life"
  | "Travel"
  | "Work"
  | "Services"
  | "Social"
  | "Family"
  | "Health"
  | "Education"
  | "Food"
  | "Shopping"
  | "Housing"
  | "Transportation"
  | "Government"
  | "Faith"
  | "Culture"
  | "Technology"
  | "Emergency"
  | "Politeness"
  | "Problem-solving"
  | "Money"
  | "Phone"
  | "Ministry"
  | "Relationships"
  | "Admin";

type CategoryBias = Category | "Any";

const CATEGORY_OPTIONS: CategoryBias[] = [
  "Any",
  "Daily life",
  "Travel",
  "Work",
  "Services",
  "Social",
  "Family",
  "Health",
  "Education",
  "Food",
  "Shopping",
  "Housing",
  "Transportation",
  "Government",
  "Faith",
  "Culture",
  "Technology",
  "Politeness",
  "Problem-solving",
  "Money",
  "Phone",
  "Ministry",
  "Relationships",
  "Admin",
  "Emergency",
];

type Phase = {
  id: string;
  title: string;
  minutes: number;
  purpose: string;
  learnerSteps: string[];
  helperScript: string;
};

type Template = {
  id: string; // prefer explicit ID: if present; otherwise stable fallback
  source: "file" | "imported";
  title: string;
  level: CEFRLevel;
  partner: "human" | "ai" | "either";
  goalCLB?: string;
  context: string;
  correction?: string;
  category: Category;
  phases: Phase[];
  twists: string[];
};

type AppSettings = {
  preferredLevel: CEFRLevel;
  partnerMode: PartnerMode;
  categoryBias: CategoryBias;
  homeMode: HomeMode; // random vs path within the chosen level
};

type RecentByLevel = Record<CEFRLevel, string[]>;

type CompletionState = {
  completedAtById: Record<string, number>; // coverage: first time only
};

type TimeState = {
  goalHours: number;
  totalSeconds: number;
  byLevelSeconds: Record<CEFRLevel, number>;
};

type SessionState = {
  templateId: string;
  phaseIndex: number;
  remainingSeconds: number;
  isRunning: boolean;
  showHelper: boolean; // helper card is hidden while running
  banner?: string;
  completedPhaseIds: string[]; // phase-level completion (within current run)
};

/* =========================
   Storage keys
========================= */

const LS_SETTINGS = "ph.settings.v2";
const LS_RECENTS = "ph.recents.v1";
const LS_IMPORTED = "ph.imported.v1";
const LS_COMPLETION = "ph.completion.v1";
const LS_TIME = "ph.time.v1";

/* =========================
   Small utilities
========================= */

function safeJsonParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function kvGet<T>(key: string, fallback: T): T {
  return safeJsonParse<T>(localStorage.getItem(key), fallback);
}

function kvSet(key: string, value: any) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

function clampMinutes(mins: number) {
  const n = Number.isFinite(mins) ? mins : 0;
  return Math.max(0, Math.min(180, Math.round(n)));
}

function formatMMSS(totalSeconds: number) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

function percent(done: number, total: number) {
  if (!total) return 0;
  return Math.max(0, Math.min(100, Math.round((done / total) * 100)));
}

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

/* =========================
   Library loading
========================= */

async function loadPerfectHourText(): Promise<string> {
  // Recommended: put the file at public/library/perfect-hour-data.txt
  // This prevents SPA fallback from returning index.html.
  const primary = "/library/perfect-hour-data.txt";

  const tryFetch = async (url: string) => {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`Could not load library (${res.status})`);
    return await res.text();
  };

  // Attempt: public path
  try {
    const raw = await tryFetch(primary);
    // If the host is serving SPA fallback HTML here, force a fallback attempt.
    if (looksLikeHtml(raw) && !raw.toUpperCase().includes("BEGIN PERFECT HOUR SESSION")) {
      throw new Error("SPA fallback");
    }
    return raw;
  } catch {
    // Fallback: relative to module (works in some dev setups when file is kept in src/library)
    const url = new URL("./library/perfect-hour-data.txt", import.meta.url);
    const raw = await tryFetch(url.toString());
    return raw;
  }
}

function looksLikeHtml(raw: string) {
  const s = (raw ?? "").trim().toLowerCase();
  return s.startsWith("<!doctype") || s.startsWith("<html") || s.includes("<head") || s.includes("<body");
}

/* =========================
   Parser
========================= */

function normalizeLine(line: string) {
  return (line ?? "").replace(/\r/g, "").trim();
}

function extractSessionBlocks(raw: string): string[] {
  const text = raw || "";
  const re = /BEGIN PERFECT HOUR SESSION[\s\S]*?END PERFECT HOUR SESSION/gim;
  const matches = text.match(re);
  return matches ? matches.map((m) => m.trim()) : [];
}

function tryExtractCEFR(levelText: string | undefined, fallback: CEFRLevel): CEFRLevel {
  const t = (levelText ?? "").toUpperCase();
  const hit = CEFR_LEVELS.find((l) => t.includes(l));
  return hit ?? fallback;
}

function inferCategoryFromContext(text: string): Category {
  const s = (text ?? "").toLowerCase();
  if (s.includes("doctor") || s.includes("medicine") || s.includes("clinic") || s.includes("pain")) return "Health";
  if (s.includes("school") || s.includes("class") || s.includes("teacher") || s.includes("homework")) return "Education";
  if (s.includes("restaurant") || s.includes("coffee") || s.includes("menu") || s.includes("eat") || s.includes("drink")) return "Food";
  if (s.includes("hotel") || s.includes("airport") || s.includes("ticket") || s.includes("directions") || s.includes("bus") || s.includes("train"))
    return "Travel";
  if (s.includes("rent") || s.includes("apartment") || s.includes("house") || s.includes("landlord")) return "Housing";
  if (s.includes("shopping") || s.includes("store") || s.includes("price") || s.includes("buy")) return "Shopping";
  if (s.includes("job") || s.includes("boss") || s.includes("meeting") || s.includes("deadline")) return "Work";
  if (s.includes("police") || s.includes("visa") || s.includes("office") || s.includes("documents")) return "Government";
  if (s.includes("church") || s.includes("prayer") || s.includes("bible") || s.includes("mosque")) return "Faith";
  if (s.includes("phone") || s.includes("app") || s.includes("wifi") || s.includes("computer")) return "Technology";
  if (s.includes("help") || s.includes("emergency") || s.includes("fire") || s.includes("hurt") || s.includes("lost")) return "Emergency"
  | "Politeness"
  | "Problem-solving"
  | "Money"
  | "Phone"
  | "Ministry"
  | "Relationships"
  | "Admin";
  if (s.includes("family") || s.includes("child") || s.includes("parents") || s.includes("wife") || s.includes("husband")) return "Family";
  if (s.includes("bank") || s.includes("post") || s.includes("service") || s.includes("counter")) return "Services";
  if (s.includes("party") || s.includes("friend") || s.includes("meet") || s.includes("invite")) return "Social";
  if (s.includes("bus") || s.includes("car") || s.includes("ride") || s.includes("traffic")) return "Transportation";
  return "Daily life";
}

function stableId(parts: string[]) {
  // Deterministic, short-ish ID for local-first usage when no explicit ID is provided
  const str = parts.join("||").trim().toLowerCase();
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `ph_${(h >>> 0).toString(16)}`;
}

function parseOneSessionBlock(block: string, fallbackLevel: CEFRLevel, source: Template["source"]): Template | null {
  // Preprocess: ensure keys appear on separate lines (handles single-line headers)
  let text = block || "";

  // Put markers on their own lines (just in case)
  text = text.replace(/BEGIN PERFECT HOUR SESSION/gi, "\nBEGIN PERFECT HOUR SESSION\n");
  text = text.replace(/END PERFECT HOUR SESSION/gi, "\nEND PERFECT HOUR SESSION\n");

  const keys = [
    "ID:",
    "Title:",
    "Level:",
    "Partner:",
    "Goal (CLB):",
    "Context:",
    "Correction:",
    "Category:",
    "PHASE",
    "Name:",
    "Minutes:",
    "Purpose:",
    "Human steps:",
    "AI helper script:",
    "Twists:",
  ];

  for (const k of keys) {
    const re = new RegExp(`\\s*${k.replace(/[()]/g, "\\$&")}`, "gi");
    text = text.replace(re, `\n${k}`);
  }

  // Normalize human steps / helper script formatting
  text = text.replace(/\nHuman steps:\s*\n/gi, "\nHuman steps:\n");
  text = text.replace(/\nAI helper script:\s*\n/gi, "\nAI helper script:\n");

  // Normalize a variety of PHASE headers into a line that starts with "PHASE"
  // Examples:
  // - PHASE 1
  // - PHASE one
  // - PHASE 1: Fluency loop (10m)
  text = text.replace(/(\n|\r|^)\s*PHASE\s+([0-9]+|one|two|three|four|five|six|seven|eight|nine|ten)\b/gi, "\nPHASE");
  text = text.replace(/(\n|\r|^)\s*PHASE\s*:/gi, "\nPHASE");

  const lines = text
    .split("\n")
    .map(normalizeLine)
    .filter((x) => x.length > 0 && x !== "BEGIN PERFECT HOUR SESSION" && x !== "END PERFECT HOUR SESSION");

  let idLine = "";
  let title = "";
  let levelText = "";
  let partnerText = "";
  let goal = "";
  let context = "";
  let correction = "";
  let category: Category | "" = "";

  const phases: Phase[] = [];
  const twists: string[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (line.toLowerCase().startsWith("id:")) {
      idLine = line.slice(3).trim();
      i++;
      continue;
    }
    if (line.toLowerCase().startsWith("title:")) {
      title = line.slice(6).trim();
      i++;
      continue;
    }
    if (line.toLowerCase().startsWith("level:")) {
      levelText = line.slice(6).trim();
      i++;
      continue;
    }
    if (line.toLowerCase().startsWith("partner:")) {
      partnerText = line.slice(8).trim();
      i++;
      continue;
    }
    if (line.toLowerCase().startsWith("goal (clb):")) {
      goal = line.slice("Goal (CLB):".length).trim();
      i++;
      continue;
    }
    if (line.toLowerCase().startsWith("context:")) {
      context = line.slice(8).trim();
      i++;
      continue;
    }
    if (line.toLowerCase().startsWith("correction:")) {
      correction = line.slice(11).trim();
      i++;
      continue;
    }
    if (line.toLowerCase().startsWith("category:")) {
      const rawCat = line.slice(9).trim();
      category = (rawCat as any) || "";
      i++;
      continue;
    }

    if (line.toUpperCase().startsWith("PHASE")) {
      // Parse one phase block
      let phTitle = "";
      let minutes = 0;
      let purpose = "";
      const learnerSteps: string[] = [];
      let helperScript = "";

      // Read until next PHASE or Twists or end
      i++;
      while (i < lines.length) {
        const l = lines[i];

        if (l.toUpperCase().startsWith("PHASE") || l.toLowerCase().startsWith("twists:")) break;

        if (l.toLowerCase().startsWith("name:")) {
          phTitle = l.slice(5).trim();
          i++;
          continue;
        }
        if (l.toLowerCase().startsWith("minutes:")) {
          const raw = l.slice(8).trim();
          const n = parseInt(raw, 10);
          minutes = Number.isFinite(n) ? n : 0;
          i++;
          continue;
        }
        if (l.toLowerCase().startsWith("purpose:")) {
          purpose = l.slice(8).trim();
          i++;
          continue;
        }

        if (l.toLowerCase().startsWith("human steps:")) {
          i++;
          while (i < lines.length) {
            const sLine = lines[i];
            if (
              sLine.toLowerCase().startsWith("ai helper script:") ||
              sLine.toUpperCase().startsWith("PHASE") ||
              sLine.toLowerCase().startsWith("twists:")
            ) {
              break;
            }
            // accept bullet points or plain lines
            const cleaned = sLine.replace(/^\*\s*/, "").trim();
            if (cleaned) learnerSteps.push(cleaned);
            i++;
          }
          continue;
        }

        if (l.toLowerCase().startsWith("ai helper script:")) {
          const first = l.slice("AI helper script:".length).trim();
          const parts: string[] = [];
          if (first) parts.push(first);
          i++;
          while (i < lines.length) {
            const sLine = lines[i];
            if (sLine.toUpperCase().startsWith("PHASE") || sLine.toLowerCase().startsWith("twists:")) break;
            if (sLine.toLowerCase().startsWith("name:") || sLine.toLowerCase().startsWith("minutes:") || sLine.toLowerCase().startsWith("purpose:")) break;
            if (sLine.toLowerCase().startsWith("human steps:") || sLine.toLowerCase().startsWith("ai helper script:")) break;
            parts.push(sLine);
            i++;
          }
          helperScript = parts.join(" ").trim();
          continue;
        }

        i++;
      }

      const phId = stableId([title, levelText, phTitle, String(minutes)]);
      phases.push({
        id: phId,
        title: phTitle || `Phase ${phases.length + 1}`,
        minutes: clampMinutes(minutes || 0),
        purpose: purpose || "",
        learnerSteps,
        helperScript: helperScript || "",
      });
      continue;
    }

    if (line.toLowerCase().startsWith("twists:")) {
      i++;
      while (i < lines.length) {
        const tLine = lines[i];
        if (tLine.toUpperCase().startsWith("PHASE")) break;
        const cleaned = tLine.replace(/^\*\s*/, "").trim();
        if (cleaned) twists.push(cleaned);
        i++;
      }
      continue;
    }

    i++;
  }

  if (!title || !context || phases.length === 0) return null;

  const level = tryExtractCEFR(levelText, fallbackLevel);
  const partnerLower = (partnerText ?? "").toLowerCase();
  const partner: Template["partner"] =
    partnerLower.includes("either") || partnerLower.includes("human or ai") ? "either" : partnerLower.includes("ai") ? "ai" : "human";

  const cat = (category && CATEGORY_OPTIONS.includes(category as any) ? (category as Category) : inferCategoryFromContext(`${title}\n${context}`)) as Category;

  const explicitId = (idLine || "").trim();
  const id = explicitId ? explicitId.toLowerCase() : stableId([source, level, title, context]).toLowerCase();

  return {
    id,
    source,
    title,
    level,
    partner,
    goalCLB: goal || undefined,
    context,
    correction: correction || undefined,
    category: cat,
    phases,
    twists,
  };
}

function parsePerfectHourText(raw: string, fallbackLevel: CEFRLevel, source: Template["source"]): Template[] {
  const blocks = extractSessionBlocks(raw);
  const templates: Template[] = [];
  for (const b of blocks) {
    const t = parseOneSessionBlock(b, fallbackLevel, source);
    if (t) templates.push(t);
  }
  return templates;
}

/* =========================
   Error Boundary
========================= */

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { err?: any }> {
  constructor(props: any) {
    super(props);
    this.state = { err: undefined };
  }
  static getDerivedStateFromError(err: any) {
    return { err };
  }
  componentDidCatch(err: any) {
    // eslint-disable-next-line no-console
    console.error("App crashed:", err);
  }
  render() {
    if (this.state.err) {
      return (
        <div style={{ maxWidth: 980, margin: "0 auto", padding: 16 }}>
          <div style={cardStyle}>
            <div style={{ fontWeight: 900, marginBottom: 10 }}>Something went wrong.</div>
            <div style={{ color: "var(--muted)", marginBottom: 10 }}>
              Open DevTools Console and look for the first red error.
            </div>
            <div style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", fontSize: 12, opacity: 0.8 }}>
              {String(this.state.err?.message ?? this.state.err)}
            </div>
          </div>
        </div>
      );
    }
    return this.props.children as any;
  }
}

/* =========================
   App
========================= */

function emptyRecents(): RecentByLevel {
  return { A1: [], A2: [], B1: [], B2: [], C1: [], C2: [] };
}

function emptyByLevelSeconds(): Record<CEFRLevel, number> {
  return { A1: 0, A2: 0, B1: 0, B2: 0, C1: 0, C2: 0 };
}

export default function App() {
  const [settings, setSettings] = useState<AppSettings>(() =>
    kvGet<AppSettings>(LS_SETTINGS, {
      preferredLevel: "A2",
      partnerMode: "human",
      categoryBias: "Any",
      homeMode: "random",
    })
  );
  useEffect(() => kvSet(LS_SETTINGS, settings), [settings]);

  const [recents, setRecents] = useState<RecentByLevel>(() => kvGet<RecentByLevel>(LS_RECENTS, emptyRecents()));
  useEffect(() => kvSet(LS_RECENTS, recents), [recents]);

  const [completion, setCompletion] = useState<CompletionState>(() => kvGet<CompletionState>(LS_COMPLETION, { completedAtById: {} }));
  useEffect(() => kvSet(LS_COMPLETION, completion), [completion]);

  const [time, setTime] = useState<TimeState>(() =>
    kvGet<TimeState>(LS_TIME, { goalHours: 300, totalSeconds: 0, byLevelSeconds: emptyByLevelSeconds() })
  );
  useEffect(() => kvSet(LS_TIME, time), [time]);

  const [screen, setScreen] = useState<Screen>("home");
  const [levelSheetLevel, setLevelSheetLevel] = useState<CEFRLevel | null>(null);
  const [session, setSession] = useState<SessionState | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  function tinyToast(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(null), 900);
  }

  // Imported sessions (optional)
  const [imported, setImported] = useState<Template[]>(() => kvGet<Template[]>(LS_IMPORTED, []));
  useEffect(() => kvSet(LS_IMPORTED, imported), [imported]);

  // File-backed library
  const [fileLibrary, setFileLibrary] = useState<{ loading: boolean; error?: string; templates: Template[] }>({
    loading: true,
    templates: [],
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await loadPerfectHourText();

        // Detect SPA fallback (HTML) early with a helpful message.
        if (looksLikeHtml(raw) && !raw.toUpperCase().includes("BEGIN PERFECT HOUR SESSION")) {
          throw new Error(
            'Library loaded HTML instead of the data file. Put "perfect-hour-data.txt" in "public/library/" so it is served at "/library/perfect-hour-data.txt", then redeploy.'
          );
        }

        const parsed = parsePerfectHourText(raw, settings.preferredLevel, "file");
        if (!parsed.length) throw new Error("No sessions found. Confirm BEGIN/END PERFECT HOUR SESSION markers exist.");

        if (!cancelled) setFileLibrary({ loading: false, templates: parsed });
      } catch (e: any) {
        if (cancelled) return;
        setFileLibrary({ loading: false, templates: [], error: String(e?.message ?? e) });
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const templates = useMemo(() => {
    // Combine file templates with imported templates
    return [...fileLibrary.templates, ...imported];
  }, [fileLibrary.templates, imported]);

  const levelTemplates = useMemo(() => {
    return templates.filter((t) => t.level === settings.preferredLevel);
  }, [templates, settings.preferredLevel]);

  const completionDoneForLevel = useMemo(() => {
    const ids = levelTemplates.map((t) => t.id);
    let done = 0;
    for (const id of ids) if (completion.completedAtById[id]) done++;
    return { done, total: ids.length };
  }, [completion.completedAtById, levelTemplates]);

  const totalCoverage = useMemo(() => {
    const ids = templates.map((t) => t.id);
    let done = 0;
    for (const id of ids) if (completion.completedAtById[id]) done++;
    return { done, total: ids.length };
  }, [completion.completedAtById, templates]);

  const totalHours = time.totalSeconds / 3600;
  const goalSeconds = Math.max(1, Math.round(time.goalHours * 3600));
  const goalPct = percent(time.totalSeconds, goalSeconds);

  function pushRecent(level: CEFRLevel, id: string, max: number) {
    setRecents((prev) => {
      const cur = prev[level] ?? [];
      const next = [id, ...cur.filter((x) => x !== id)].slice(0, max);
      return { ...prev, [level]: next };
    });
  }

  function pickPathTemplate(level: CEFRLevel, categoryBias: CategoryBias): Template | null {
    const list = templates
      .filter((t) => t.level === level)
      .filter((t) => (categoryBias === "Any" ? true : t.category === categoryBias));

    if (!list.length) return null;

    // Prefer stable numeric order when explicit IDs look like "A2-0012"
    const numeric = (id: string) => {
      const m = id.match(/^[a-c][0-2][-_](\d+)/i);
      return m ? parseInt(m[1], 10) : Number.NaN;
    };

    const sorted = [...list].sort((a, b) => {
      const na = numeric(a.id);
      const nb = numeric(b.id);
      if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
      return a.title.localeCompare(b.title);
    });

    const nextUncompleted = sorted.find((t) => !completion.completedAtById[t.id]);
    return nextUncompleted ?? sorted[0];
  }

  function pickRandomTemplate(level: CEFRLevel, categoryBias: CategoryBias): Template | null {
    const list = templates
      .filter((t) => t.level === level)
      .filter((t) => (categoryBias === "Any" ? true : t.category === categoryBias));
    if (!list.length) return null;

    const avoid = new Set((recents[level] ?? []).slice(0, 6));
    const pool = list.filter((t) => !avoid.has(t.id));
    const pickFrom = pool.length ? pool : list;

    const idx = Math.floor(Math.random() * pickFrom.length);
    return pickFrom[idx] ?? pickFrom[0] ?? null;
  }

  
  function startSessionFromTemplate(t: Template) {
    // Ensure the selected level matches the session (useful when starting from the checklist).
    if (t.level !== settings.preferredLevel) {
      setSettings((s) => ({ ...s, preferredLevel: t.level }));
    }

    pushRecent(t.level, t.id, 8);

    setSession({
      templateId: t.id,
      phaseIndex: 0,
      remainingSeconds: clampMinutes(t.phases[0]?.minutes ?? 60) * 60,
      isRunning: false,
      banner: undefined,
      completedPhaseIds: [],
      completedAtEnd: false,
    });

    setScreen("session");
  }

  function startTemplateById(templateId: string) {
    const t = templates.find((x) => x.id === templateId);
    if (!t) return;
    setLevelSheetLevel(null);
    startSessionFromTemplate(t);
  }


function startTemplateFromSheet(t: Template) {
  setLevelSheetLevel(null);
  startSessionFromTemplate(t);
}

function toggleCompleteById(templateId: string) {
  setCompletion((prev) => {
    const next = { ...prev.completedAtById };
    if (next[templateId]) {
      delete next[templateId];
    } else {
      next[templateId] = Date.now();
    }
    return { completedAtById: next };
  });
}

  function startPerfectHour() {
      const level = settings.preferredLevel;
      const bias = settings.categoryBias;
  
      const t =
        settings.homeMode === "path" ? pickPathTemplate(level, bias) : pickRandomTemplate(level, bias);
  
      if (!t) return;
      startSessionFromTemplate(t);
    }

  function goHome() {
    setScreen("home");
    setSession(null);
  }

  const currentTemplate = useMemo(() => {
    if (!session) return null;
    return templates.find((t) => t.id === session.templateId) ?? null;
  }, [session, templates]);

  // Time tracking: counts anytime the timer is running (repeats count too)
  useEffect(() => {
    if (screen !== "session" || !session?.isRunning || !currentTemplate) return;

    const level = currentTemplate.level;
    const id = window.setInterval(() => {
      setTime((prev) => ({
        ...prev,
        totalSeconds: prev.totalSeconds + 1,
        byLevelSeconds: { ...prev.byLevelSeconds, [level]: (prev.byLevelSeconds[level] ?? 0) + 1 },
      }));
    }, 1000);

    return () => window.clearInterval(id);
  }, [screen, session?.isRunning, currentTemplate]);

  return (
    <ErrorBoundary>
      <div style={{ maxWidth: 980, margin: "0 auto", padding: "18px 14px 36px" }}>
        <Card
          style={{
            padding: 14,
            position: "sticky",
            top: 12,
            zIndex: 10,
            background: "linear-gradient(180deg, rgba(37, 99, 235, 0.13), rgba(255,255,255,0.86))",
            backdropFilter: "blur(14px)",
                      border: "1px solid var(--border-strong)",
            boxShadow: "var(--shadow-sm)",
}}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div style={{ display: "grid", gap: 4 }}>
              <div style={{ fontWeight: 995, fontSize: 20, letterSpacing: "-0.04em", backgroundImage: "linear-gradient(90deg, var(--accent), var(--accent2))", WebkitBackgroundClip: "text", color: "transparent" }}>{APP_NAME}</div>
              <div style={{ color: "var(--muted)", fontSize: 13, maxWidth: 420 }}>
                {APP_SUBTITLE}
              </div>
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <MenuButton
                label={`Level: ${settings.preferredLevel}`}
                items={CEFR_LEVELS.map((lvl) => ({
                  key: lvl,
                  label: `${lvl} — ${LEVEL_EQUIV[lvl].label}`,
                  onSelect: () => setSettings((s) => ({ ...s, preferredLevel: lvl })),
                }))}
              />
              <MenuButton
                label={`Mode: ${settings.homeMode === "path" ? "Path" : "Random"}`}
                items={[
                  { key: "random", label: "Random (fresh practice)", onSelect: () => setSettings((s) => ({ ...s, homeMode: "random" })) },
                  { key: "path", label: "Path (complete sessions)", onSelect: () => setSettings((s) => ({ ...s, homeMode: "path" })) },
                ]}
              />
              {screen === "session" ? (
                <Button variant="soft" onClick={goHome}>
                  Home
                </Button>
              ) : null}
            </div>
          </div>
        </Card>

        <div style={{ display: "grid", gap: 14, marginTop: 14 }}>
          {screen === "home" ? (
            <>
              <Card>
              {/* Visible guidance: one short line */}
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 950, letterSpacing: "-0.02em" }}>Home</div>
                  <div style={{ color: "var(--muted)", marginTop: 4 }}>{APP_TAGLINE}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontWeight: 900 }}>{totalHours.toFixed(1)}h</div>
                  <div style={{ color: "var(--muted)", fontSize: 12 }}>of {time.goalHours}h</div>
                </div>
              </div>

              <div style={{ height: 10 }} />

              {/* Hours progress (minimal, premium) */}
              <div style={{ display: "grid", gap: 8 }}>
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
                  <div style={{ height: "100%", width: `${goalPct}%`, background: "rgba(37, 99, 235, 0.24)" }} />
                </div>
                <div style={{ color: "var(--muted)", fontSize: 12 }}>Progress toward your hours goal.</div>
              </div>

              <div style={{ height: 12 }} />

              {/* Duolingo-style level path (selectable, no lock) */}
              <div style={{ display: "grid", gap: 8 }}>
                {CEFR_LEVELS.map((lvl) => {
                  const list = templates.filter((t) => t.level === lvl);
                  const done = list.filter((t) => completion.completedAtById[t.id]).length;
                  const p = percent(done, list.length);
                  const active = lvl === settings.preferredLevel;
                  return (
                    <button
                      key={lvl}
                      onClick={() => {
                      setSettings((s) => ({ ...s, preferredLevel: lvl }));
                      setLevelSheetLevel(lvl);
                    }}
                      style={{
                        ...levelRowStyle,
                        borderColor: active ? "rgba(37, 99, 235, 0.35)" : "var(--border)",
                        boxShadow: active ? "0 0 0 4px rgba(37, 99, 235, 0.08), var(--shadow-sm)" : "var(--shadow-sm)",
                        background: active ? "rgba(37, 99, 235, 0.04)" : "rgba(255,255,255,0.55)",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                        <div style={{ display: "grid", gap: 2, textAlign: "left" }}>
                          <div style={{ fontWeight: 950, letterSpacing: "-0.01em" }}>
                            {lvl} <span style={{ color: "var(--muted)", fontWeight: 700 }}>• {LEVEL_EQUIV[lvl].label}</span>
                          </div>
                          <div style={{ color: "var(--muted)", fontSize: 12 }}>
                            Coverage: {p}% • {done}/{list.length || 0}
                          </div>
                        </div>

                        <div style={{ minWidth: 56, textAlign: "right" }}>
                          <div style={{ fontWeight: 900 }}>{p}%</div>
                          <div style={{ color: "var(--muted)", fontSize: 12 }}>{LEVEL_EQUIV[lvl].clb}</div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>

              <div style={{ height: 12 }} />

              {fileLibrary.error ? (
                <div style={{ color: "rgba(220, 38, 38, 0.92)" }}>
                  <strong>Library issue:</strong> {fileLibrary.error}
                </div>
              ) : null}

              <Button variant="primary" onClick={startPerfectHour} disabled={fileLibrary.loading || !!fileLibrary.error || levelTemplates.length === 0} full>
                Start my fluent hour
              </Button>

              <div style={{ height: 12 }} />

              <Collapse title="Advanced" defaultOpen={false}>
                <div style={{ display: "grid", gap: 12 }}>
                  <Card style={{ boxShadow: "var(--shadow-sm)", background: "rgba(15, 23, 42, 0.02)" }}>
                    <div style={{ display: "grid", gap: 10 }}>
                      <div style={{ display: "grid", gap: 6 }}>
                        <div style={{ fontWeight: 900 }}>Mode</div>
                        <select
                          value={settings.homeMode}
                          onChange={(e) => setSettings((s) => ({ ...s, homeMode: e.target.value as HomeMode }))}
                          style={inputStyle}
                        >
                          <option value="random">Random (within level)</option>
                          <option value="path">Path (next uncompleted)</option>
                        </select>
                      </div>

                      <div style={{ display: "grid", gap: 6 }}>
                        <div style={{ fontWeight: 900 }}>Focus category</div>
                        <select
                          value={settings.categoryBias}
                          onChange={(e) => setSettings((s) => ({ ...s, categoryBias: e.target.value as CategoryBias }))}
                          style={inputStyle}
                        >
                          {CATEGORY_OPTIONS.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                        <div style={{ color: "var(--muted)", fontSize: 12 }}>Optional. Random and Path both stay inside your selected level.</div>
                      </div>

                      <div style={{ display: "grid", gap: 6 }}>
                        <div style={{ fontWeight: 900 }}>Partner mode</div>
                        <select
                          value={settings.partnerMode}
                          onChange={(e) => setSettings((s) => ({ ...s, partnerMode: e.target.value as PartnerMode }))}
                          style={inputStyle}
                        >
                          <option value="human">Human helper (preferred)</option>
                          <option value="ai">AI helper (fallback)</option>
                        </select>
                      </div>
                    </div>
                  </Card>

                  <Card style={{ boxShadow: "var(--shadow-sm)", background: "rgba(15, 23, 42, 0.02)" }}>
                    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                      <div style={{ fontWeight: 900 }}>Goals and totals</div>
                      <Pill>
                        Coverage: {totalCoverage.done}/{totalCoverage.total}
                      </Pill>
                    </div>

                    <div style={{ height: 10 }} />

                    <div style={{ display: "grid", gap: 8 }}>
                      <label style={{ display: "grid", gap: 6 }}>
                        <div style={{ fontWeight: 900 }}>Hours goal</div>
                        <input
                          type="number"
                          min={1}
                          step={10}
                          value={time.goalHours}
                          onChange={(e) => {
                            const n = parseInt(e.target.value, 10);
                            setTime((prev) => ({ ...prev, goalHours: Number.isFinite(n) ? n : prev.goalHours }));
                          }}
                          style={inputStyle}
                        />
                      </label>

                      <div style={{ color: "var(--muted)", fontSize: 12 }}>Time always counts, even when you repeat sessions.</div>

                      <Button
                        variant="soft"
                        onClick={() => {
                          if (!confirm("Reset time totals? This cannot be undone.")) return;
                          setTime({ goalHours: time.goalHours, totalSeconds: 0, byLevelSeconds: emptyByLevelSeconds() });
                        }}
                      >
                        Reset time totals
                      </Button>

                      <Button
                        variant="soft"
                        onClick={() => {
                          if (!confirm("Reset coverage completion? This cannot be undone.")) return;
                          setCompletion({ completedAtById: {} });
                        }}
                      >
                        Reset coverage completion
                      </Button>
                    </div>
                  </Card>

                  <ImportBuilder
                    onToast={tinyToast}
                    onImport={(parsed) => setImported((prev) => [...parsed, ...prev])}
                    defaultLevel={settings.preferredLevel}
                    defaultCategory={settings.categoryBias === "Any" ? "Daily life" : (settings.categoryBias as Category)}
                  />
                </div>
              </Collapse>
            </Card>

            {levelSheetLevel ? (
              <LevelChecklistSheet
                level={levelSheetLevel}
                templates={templates}
                completion={completion}
                onStartTemplate={startTemplateFromSheet}
                onToggleComplete={toggleCompleteById}
                onClose={() => setLevelSheetLevel(null)}
              />
            ) : null}
            </>
          ) : (
            <Runner
              settings={settings}
              template={currentTemplate}
              session={session}
              setSession={setSession}
              onCopy={async (txt) => tinyToast((await copyToClipboard(txt)) ? "Copied" : "Copy failed")}
              onMarkComplete={() => {
                if (!currentTemplate) return;
                setCompletion((prev) => {
                  if (prev.completedAtById[currentTemplate.id]) return prev;
                  return { completedAtById: { ...prev.completedAtById, [currentTemplate.id]: Date.now() } };
                });
                tinyToast("Marked complete");
              }}
            />
          )}
        </div>

        {toast ? <Toast msg={toast} /> : null}
      </div>
    </ErrorBoundary>
  );
}

/* =========================
   Runner (Session screen)
========================= */

function Runner(props: {
  settings: AppSettings;
  template: Template | null;
  session: SessionState | null;
  setSession: React.Dispatch<React.SetStateAction<SessionState | null>>;
  onCopy: (txt: string) => void;
  onMarkComplete: () => void;
}) {
  const s = props.session;
  const t = props.template;

  if (!s || !t) {
    return (
      <Card>
        <div style={{ fontSize: 18, fontWeight: 950, letterSpacing: "-0.02em" }}>Session</div>
        <div style={{ color: "var(--muted)", marginTop: 4 }}>No active session.</div>
      </Card>
    );
  }

  const phase = t.phases[s.phaseIndex] ?? t.phases[0];
  const phaseTotalSeconds = clampMinutes(phase.minutes) * 60;
  const progress = phaseTotalSeconds <= 0 ? 0 : 1 - s.remainingSeconds / phaseTotalSeconds;

  // Autopause timer tick
  const intervalRef = useRef<number | null>(null);
  useEffect(() => {
    if (!s.isRunning) {
      if (intervalRef.current) window.clearInterval(intervalRef.current);
      intervalRef.current = null;
      return;
    }

    if (intervalRef.current) window.clearInterval(intervalRef.current);

    intervalRef.current = window.setInterval(() => {
      props.setSession((prev) => {
        if (!prev || !t) return prev;
        if (!prev.isRunning) return prev;

        const next = prev.remainingSeconds - 1;
        if (next > 0) return { ...prev, remainingSeconds: next };

        const currentPhaseId = t.phases[prev.phaseIndex]?.id;
        const completedPhaseIds =
          currentPhaseId && !prev.completedPhaseIds.includes(currentPhaseId)
            ? [...prev.completedPhaseIds, currentPhaseId]
            : prev.completedPhaseIds;

        const atEnd = prev.phaseIndex >= t.phases.length - 1;
        if (atEnd) {
          return { ...prev, completedPhaseIds, remainingSeconds: 0, isRunning: false, showHelper: false, banner: "Session complete" };
        }

        const nextIndex = prev.phaseIndex + 1;
        const nextPhase = t.phases[nextIndex];

        return {
          ...prev,
          completedPhaseIds,
          phaseIndex: nextIndex,
          remainingSeconds: clampMinutes(nextPhase.minutes) * 60,
          isRunning: false,
          showHelper: false,
          banner: "Phase complete",
        };
      });
    }, 1000);

    return () => {
      if (intervalRef.current) window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    };
  }, [s.isRunning, props, t]);

  // While running, helper must be hidden
  useEffect(() => {
    if (s.isRunning && s.showHelper) {
      props.setSession((prev) => (prev ? { ...prev, showHelper: false } : prev));
    }
  }, [s.isRunning, s.showHelper, props]);

  function toggleRun() {
    props.setSession((prev) => (prev ? { ...prev, isRunning: !prev.isRunning, banner: undefined } : prev));
  }

  function restartPhase() {
    props.setSession((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        remainingSeconds: clampMinutes(phase.minutes) * 60,
        isRunning: false,
        showHelper: false,
        banner: "Restarted",
      };
    });
  }

  function skipToNext() {
    // counts the current phase as done (even if you finish early)
    props.setSession((prev) => {
      if (!prev) return prev;

      const currentPhaseId = t.phases[prev.phaseIndex]?.id;
      const completedPhaseIds =
        currentPhaseId && !prev.completedPhaseIds.includes(currentPhaseId)
          ? [...prev.completedPhaseIds, currentPhaseId]
          : prev.completedPhaseIds;

      const atEnd = prev.phaseIndex >= t.phases.length - 1;
      if (atEnd) {
        return { ...prev, completedPhaseIds, isRunning: false, remainingSeconds: 0, showHelper: false, banner: "Session complete" };
      }

      const nextIndex = prev.phaseIndex + 1;
      const nextPhase = t.phases[nextIndex];

      return {
        ...prev,
        completedPhaseIds,
        phaseIndex: nextIndex,
        remainingSeconds: clampMinutes(nextPhase.minutes) * 60,
        isRunning: false,
        showHelper: false,
        banner: "Moved to next phase",
      };
    });
  }

  const helperBundle = useMemo(() => {
    const eq = LEVEL_EQUIV[t.level];
    return [
      "You are my language helper.",
      `Level: ${t.level} (${eq.actfl}; ${eq.clb})`,
      `Session: ${t.title}`,
      `Context: ${t.context}`,
      t.goalCLB ? `Goal (CLB): ${t.goalCLB}` : "",
      t.correction ? `Correction: ${t.correction}` : "",
      "",
      `Current phase: ${phase.title} (${clampMinutes(phase.minutes)} minutes)`,
      `Purpose: ${phase.purpose}`,
      "",
      "Learner steps:",
      ...phase.learnerSteps.map((x, idx) => `${idx + 1}. ${x}`),
      "",
      "Helper script:",
      phase.helperScript,
    ]
      .filter(Boolean)
      .join("\n");
  }, [t, phase]);

  return (
    <Card>
      {/* Visible guidance: one short line */}
      <div style={{ fontSize: 18, fontWeight: 950, letterSpacing: "-0.02em" }}>Session</div>
      <div style={{ color: "var(--muted)", marginTop: 4 }}>
        {t.level} • {t.category} • Phase {s.phaseIndex + 1} of {t.phases.length}
      </div>

      <div style={{ height: 12 }} />

      {/* Banner for phase/session transitions */}
      {s.banner ? (
        <Card style={{ boxShadow: "var(--shadow-sm)", background: "rgba(37, 99, 235, 0.04)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <div style={{ fontWeight: 900 }}>{s.banner}</div>
            {s.banner === "Session complete" ? (
              <Button variant="soft" onClick={props.onMarkComplete}>
                Mark complete
              </Button>
            ) : null}
          </div>
        </Card>
      ) : null}

      <div style={{ height: 12 }} />

      {/* Timer card */}
      <Card style={{ boxShadow: "var(--shadow-sm)", background: "rgba(37, 99, 235, 0.04)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <div>
            <div style={{ fontWeight: 980, fontSize: 30, letterSpacing: "-0.02em" }}>{formatMMSS(s.remainingSeconds)}</div>
            <div style={{ color: "var(--muted)", marginTop: 4 }}>{phase.title}</div>
          </div>

          <Button variant="primary" onClick={toggleRun}>
            {s.isRunning ? "Pause" : "Start"}
          </Button>
        </div>

        <div style={{ height: 10 }} />

        <div style={{ height: 10, borderRadius: 999, border: "1px solid var(--border)", background: "rgba(15, 23, 42, 0.03)", overflow: "hidden", boxShadow: "var(--shadow-sm)" }}>
          <div style={{ height: "100%", width: `${Math.round(progress * 100)}%`, background: "rgba(37, 99, 235, 0.26)" }} />
        </div>
      </Card>

      <div style={{ height: 12 }} />

      {/* Learner card */}
      <Card style={{ boxShadow: "var(--shadow-sm)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ fontWeight: 950 }}>Learner</div>
          <Pill>{s.isRunning ? "Running" : "Paused"}</Pill>
        </div>

        <div style={{ marginTop: 10, color: "var(--muted)" }}>
          <strong>Situation:</strong> {t.title}. {t.context}
        </div>

        {(t.goalCLB || t.correction) ? (
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

      <Collapse title="Advanced" defaultOpen={false}>
        <div style={{ display: "grid", gap: 12 }}>
          <Card style={{ boxShadow: "var(--shadow-sm)", background: "rgba(15, 23, 42, 0.02)" }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Button variant="soft" onClick={restartPhase}>
                Restart phase
              </Button>
              <Button variant="soft" onClick={skipToNext}>
                Skip to next
              </Button>
              {!s.isRunning ? (
                <Button
                  variant="soft"
                  onClick={() => props.setSession((prev) => (prev ? { ...prev, showHelper: !prev.showHelper } : prev))}
                >
                  {s.showHelper ? "Hide helper" : "Show helper"}
                </Button>
              ) : null}
            </div>
            <div style={{ color: "var(--muted)", marginTop: 10, fontSize: 12 }}>
              Helper stays hidden while running.
            </div>
          </Card>

          {!s.isRunning && s.showHelper ? (
            <Card style={{ boxShadow: "var(--shadow-sm)", background: "rgba(15, 23, 42, 0.02)" }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div style={{ fontWeight: 950 }}>Helper</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <Button variant="soft" onClick={() => props.onCopy(helperBundle)}>
                    Copy helper prompt
                  </Button>
                </div>
              </div>

              <div style={{ height: 10 }} />

              <textarea readOnly value={helperBundle} rows={10} style={textareaStyleMono} />
            </Card>
          ) : null}

          <Collapse title="Localize for your context" defaultOpen={false}>
            <Card style={{ boxShadow: "var(--shadow-sm)", background: "rgba(15, 23, 42, 0.02)" }}>
              <div style={{ color: "var(--muted)" }}>
                Keep the same communicative goal, but adjust cultural details:
              </div>
              <ul style={{ margin: 0, marginTop: 10, paddingLeft: 18, color: "var(--muted)", display: "grid", gap: 8 }}>
                <li><strong>Setting:</strong> street, market, office, village gathering, café, mosque courtyard, metro platform.</li>
                <li><strong>Politeness:</strong> shorten or soften the script depending on Istanbul, Paris, PNG villages, Oman, or your local norms.</li>
                <li><strong>Nonverbal cues:</strong> distance, eye contact, hand gestures, turn-taking.</li>
                <li><strong>Vocabulary swap:</strong> bus/taxi, clerk/elder, clinic/pharmacy, card/cash.</li>
              </ul>
            </Card>
          </Collapse>

          {t.twists?.length ? (
            <Collapse title="Twists" defaultOpen={false}>
              <Card style={{ boxShadow: "var(--shadow-sm)", background: "rgba(15, 23, 42, 0.02)" }}>
                <ul style={{ margin: 0, paddingLeft: 18, color: "var(--muted)", display: "grid", gap: 8 }}>
                  {t.twists.map((x, idx) => (
                    <li key={idx}>{x}</li>
                  ))}
                </ul>
              </Card>
            </Collapse>
          ) : null}
        </div>
      </Collapse>
    </Card>
  );
}

/* =========================
   Import builder (Home > Advanced)
========================= */

function ImportBuilder(props: {
  defaultLevel: CEFRLevel;
  defaultCategory: Category;
  onImport: (templates: Template[]) => void;
  onToast: (msg: string) => void;
}) {
  const [level, setLevel] = useState<CEFRLevel>(props.defaultLevel);
  const [category, setCategory] = useState<Category>(props.defaultCategory);
  const [partner, setPartner] = useState<Template["partner"]>("either");
  const [situation, setSituation] = useState("");
  const [correction, setCorrection] = useState("");
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState<string | null>(null);

  useEffect(() => {
    setLevel(props.defaultLevel);
  }, [props.defaultLevel]);

  const aiPrompt = useMemo(() => {
    const eq = LEVEL_EQUIV[level];
    const cleanSituation = situation.trim() || "[Write the situation in one or two sentences.]";
    const cleanCorrection = correction.trim();
    const partnerLine = partner === "either" ? "Partner: Human or AI" : partner === "human" ? "Partner: Human" : "Partner: AI";

    return [
      "You are generating a FluentHour session template for language practice.",
      "",
      "Output must be EXACTLY in this format, with markers on their own lines:",
      "BEGIN PERFECT HOUR SESSION",
      "ID: " + `${level}-` + "XXXX (use any unique code)",
      "Title: " + "[Short title for the situation]",
      `Level: ${level} (${eq.actfl}; ${eq.clb})`,
      partnerLine,
      "Category: " + category,
      "Goal (CLB): " + "[One can-do statement]",
      "Context: " + cleanSituation,
      cleanCorrection ? "Correction: " + cleanCorrection : "Correction: " + "[What errors should the helper recast?]",
      "",
      "PHASE 1",
      "Name: Fluency loop",
      "Minutes: 10",
      "Purpose: " + "[Automate key phrases for this situation.]",
      "Human steps:",
      "* " + "[Four to six short bullet steps.]",
      "AI helper script: " + "[One short paragraph to guide the helper.]",
      "",
      "PHASE 2",
      "Name: Model and input",
      "Minutes: 25",
      "Purpose: " + "[Provide model lines and listening.]",
      "Human steps:",
      "* " + "[Four to six bullets.]",
      "AI helper script: " + "[One short paragraph.]",
      "",
      "PHASE 3",
      "Name: Simulation output",
      "Minutes: 15",
      "Purpose: " + "[Perform the situation with short turns.]",
      "Human steps:",
      "* " + "[Four to six bullets.]",
      "AI helper script: " + "[One short paragraph.]",
      "",
      "PHASE 4",
      "Name: Record and focus",
      "Minutes: 10",
      "Purpose: " + "[Record, listen, and pick one correction focus.]",
      "Human steps:",
      "* " + "[Three to five bullets.]",
      "AI helper script: " + "[One short paragraph.]",
      "",
      "Twists:",
      "* " + "[Five twist bullets.]",
      "END PERFECT HOUR SESSION",
      "",
      "Return ONLY the session text. No commentary.",
    ].join("\n");
  }, [level, category, partner, situation, correction]);

  function importFromTextAndSave() {
    setImportError(null);
    const parsed = parsePerfectHourText(importText, level, "imported");
    if (!parsed.length) {
      setImportError("No sessions found in the pasted text. Make sure it includes BEGIN/END markers.");
      return;
    }
    props.onImport(parsed);
    props.onToast("Imported");
    setImportText("");
    setSituation("");
    setCorrection("");
  }

  return (
    <Card style={{ boxShadow: "var(--shadow-sm)", background: "rgba(15, 23, 42, 0.02)" }}>
      <div style={{ fontWeight: 900 }}>Import your own sessions</div>
      <div style={{ color: "var(--muted)", marginTop: 6 }}>
        Copy the AI prompt, run it in your AI, then paste the result.
      </div>

      <div style={{ height: 12 }} />

      <div style={{ display: "grid", gap: 10 }}>
        <div style={{ display: "grid", gap: 6 }}>
          <div style={{ fontWeight: 900 }}>Level</div>
          <select value={level} onChange={(e) => setLevel(e.target.value as CEFRLevel)} style={inputStyle}>
            {CEFR_LEVELS.map((l) => (
              <option key={l} value={l}>
                {l} — {LEVEL_EQUIV[l].actfl} — {LEVEL_EQUIV[l].clb}
              </option>
            ))}
          </select>
        </div>

        <div style={{ display: "grid", gap: 6 }}>
          <div style={{ fontWeight: 900 }}>Category</div>
          <select value={category} onChange={(e) => setCategory(e.target.value as Category)} style={inputStyle}>
            {CATEGORY_OPTIONS.filter((x) => x !== "Any").map((c) => (
              <option key={c} value={c as any}>
                {c}
              </option>
            ))}
          </select>
        </div>

        <div style={{ display: "grid", gap: 6 }}>
          <div style={{ fontWeight: 900 }}>Partner</div>
          <select value={partner} onChange={(e) => setPartner(e.target.value as any)} style={inputStyle}>
            <option value="either">Human or AI</option>
            <option value="human">Human only</option>
            <option value="ai">AI only</option>
          </select>
        </div>

        <div style={{ display: "grid", gap: 6 }}>
          <div style={{ fontWeight: 900 }}>Situation (one or two sentences)</div>
          <textarea
            value={situation}
            onChange={(e) => setSituation(e.target.value)}
            rows={3}
            style={textareaStyle}
            placeholder="Example: You accidentally bump into someone on a crowded street."
          />
        </div>

        <div style={{ display: "grid", gap: 6 }}>
          <div style={{ fontWeight: 900 }}>Correction focus (optional)</div>
          <input
            value={correction}
            onChange={(e) => setCorrection(e.target.value)}
            style={inputStyle}
            placeholder='Example: Recast "Bad me" → "I’m sorry."'
          />
        </div>

        <Button
          variant="soft"
          onClick={async () => props.onToast((await copyToClipboard(aiPrompt)) ? "AI prompt copied" : "Copy failed")}
        >
          Copy AI prompt
        </Button>

        <textarea readOnly value={aiPrompt} rows={10} style={textareaStyleMono} />

        <div style={{ fontWeight: 900 }}>Paste AI result</div>
        <textarea
          value={importText}
          onChange={(e) => {
            setImportText(e.target.value);
            setImportError(null);
          }}
          rows={10}
          style={textareaStyleMono}
          placeholder="Paste the session block(s) here…"
        />

        {importError ? (
          <div style={{ color: "rgba(220, 38, 38, 0.92)" }}>
            <strong>Import issue:</strong> {importError}
          </div>
        ) : null}

        <Button variant="primary" onClick={importFromTextAndSave} disabled={!importText.trim()} full>
          Import and save locally
        </Button>
      </div>
    </Card>
  );
}

/* =========================
   UI components
========================= */

function Card(props: React.PropsWithChildren<{ style?: React.CSSProperties }>) {
  return (
    <div style={{ ...cardStyle, ...(props.style ?? {}) }}>
      {props.children}
    </div>
  );
}

function Button(props: React.PropsWithChildren<{ onClick?: () => void; disabled?: boolean; full?: boolean; variant: "primary" | "soft" }>) {
  const { variant } = props;
  const style = variant === "primary" ? primaryButtonStyle : softButtonStyle;
  return (
    <button
      onClick={props.onClick}
      disabled={props.disabled}
      style={{
        ...style,
        width: props.full ? "100%" : undefined,
        opacity: props.disabled ? 0.55 : 1,
        cursor: props.disabled ? "not-allowed" : "pointer",
      }}
    >
      {props.children}
    </button>
  );
}

function Pill(props: React.PropsWithChildren<{}>) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "6px 10px",
        borderRadius: 999,
        border: "1px solid var(--border)",
        background: "rgba(255,255,255,0.6)",
        boxShadow: "var(--shadow-sm)",
        fontSize: 12,
        color: "var(--muted)",
      }}
    >
      {props.children}
    </span>
  );
}

function Collapse(props: React.PropsWithChildren<{ title: string; defaultOpen?: boolean }>) {
  const [open, setOpen] = useState(!!props.defaultOpen);
  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          padding: "10px 12px",
          borderRadius: 14,
          border: "1px solid var(--border)",
          background: "rgba(255,255,255,0.55)",
          boxShadow: "var(--shadow-sm)",
          cursor: "pointer",
          fontWeight: 900,
        }}
      >
        <span>{props.title}</span>
        <span style={{ color: "var(--muted)", fontWeight: 800 }}>{open ? "Hide" : "Show"}</span>
      </button>
      {open ? <div style={{ marginTop: 10 }}>{props.children}</div> : null}
    </div>
  );
}

type MenuItem = { key: string; label: string; onSelect: () => void };

function MenuButton(props: { label: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!open) return;
      const el = ref.current;
      if (!el) return;
      if (e.target instanceof Node && !el.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          borderRadius: 999,
          border: "1px solid var(--border)",
          background: "rgba(255,255,255,0.70)",
          padding: "10px 12px",
          boxShadow: "var(--shadow-sm)",
          display: "flex",
          alignItems: "center",
          gap: 10,
          fontWeight: 900,
          letterSpacing: "-0.01em",
        }}
      >
        <span>{props.label}</span>
        <span style={{ color: "var(--muted)", fontWeight: 900 }}>▾</span>
      </button>

      {open ? (
        <div
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 8px)",
            minWidth: 260,
            background: "rgba(255,255,255,0.92)",
            border: "1px solid var(--border-strong)",
            boxShadow: "var(--shadow-sm)",
            borderRadius: 16,
            boxShadow: "var(--shadow)",
            backdropFilter: "blur(14px)",
            padding: 6,
            zIndex: 50,
          }}
        >
          {props.items.map((it) => (
            <button
              key={it.key}
              onClick={() => {
                it.onSelect();
                setOpen(false);
              }}
              style={{
                width: "100%",
                textAlign: "left",
                padding: "10px 12px",
                borderRadius: 12,
                border: "1px solid transparent",
                background: "transparent",
                fontWeight: 850,
              }}
            >
              <span>{it.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function LevelChecklistSheet(props: {
  level: CEFRLevel;
  templates: Template[];
  completion: CompletionState;
  onStartTemplate: (t: Template) => void;
  onToggleComplete: (templateId: string) => void;
  onClose: () => void;
}) {
  const list = useMemo(() => props.templates.filter((t) => t.level === props.level), [props.templates, props.level]);

  const incomplete = useMemo(() => list.filter((t) => !props.completion.completedAtById[t.id]), [list, props.completion]);
  const complete = useMemo(() => list.filter((t) => props.completion.completedAtById[t.id]), [list, props.completion]);

  function Row({ t }: { t: Template }) {
    const done = !!props.completion.completedAtById[t.id];
    return (
      <div
        style={{
          padding: 12,
          borderRadius: 16,
          border: "1px solid var(--border)",
          background: "rgba(255,255,255,0.70)",
          boxShadow: "var(--shadow-sm)",
          display: "grid",
          gridTemplateColumns: "34px 1fr",
          gap: 10,
          alignItems: "start",
        }}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            props.onToggleComplete(t.id);
          }}
          aria-label={done ? "Mark incomplete" : "Mark complete"}
          title={done ? "Marked complete (click to undo)" : "Mark complete"}
          style={{
            width: 34,
            height: 34,
            borderRadius: 12,
            border: done ? "1px solid rgba(37, 99, 235, 0.35)" : "1px solid var(--border)",
            background: done ? "rgba(37, 99, 235, 0.10)" : "rgba(255,255,255,0.9)",
            boxShadow: "var(--shadow-sm)",
            display: "grid",
            placeItems: "center",
            cursor: "pointer",
          }}
        >
          <span style={{ fontWeight: 950, color: done ? "rgba(37, 99, 235, 0.95)" : "rgba(15, 23, 42, 0.55)" }}>
            {done ? "✓" : "◻"}
          </span>
        </button>

        <button
          type="button"
          onClick={() => props.onStartTemplate(t)}
          style={{
            border: "none",
            background: "transparent",
            padding: 0,
            textAlign: "left",
            cursor: "pointer",
            display: "grid",
            gap: 6,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
            <div style={{ fontWeight: 950, letterSpacing: "-0.01em" }}>{t.title}</div>
            <Pill style={{ fontSize: 12 }}>{t.category}</Pill>
          </div>

          <div style={{ color: "var(--muted)", fontSize: 13, lineHeight: 1.35 }}>
            {t.context}
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Pill style={{ fontSize: 12 }}>{t.level}</Pill>
            {done ? <Pill style={{ fontSize: 12 }}>Completed</Pill> : <Pill style={{ fontSize: 12 }}>Not completed</Pill>}
          </div>
        </button>
      </div>
    );
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, 0.22)",
        backdropFilter: "blur(6px)",
        zIndex: 60,
        display: "flex",
        justifyContent: "flex-end",
      }}
    >
      <div
        style={{
          width: "min(560px, 94vw)",
          height: "100%",
          background: "rgba(255,255,255,0.92)",
          borderLeft: "1px solid var(--border)",
          boxShadow: "var(--shadow)",
          padding: 16,
          overflow: "auto",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ display: "grid", gap: 6 }}>
            <div style={{ fontWeight: 980, fontSize: 18, letterSpacing: "-0.02em" }}>
              {props.level} checklist
            </div>
            <div style={{ color: "var(--muted)", fontSize: 13 }}>
              Click a session to start it. Use the checkbox to restore progress.
            </div>
          </div>
          <Button variant="soft" onClick={props.onClose}>
            Close
          </Button>
        </div>

        <div style={{ height: 12 }} />

        <div style={{ display: "grid", gap: 10 }}>
          {incomplete.length ? (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
                <div style={{ fontWeight: 950 }}>Up next</div>
                <Pill style={{ fontSize: 12 }}>
                  Incomplete: {incomplete.length}/{list.length}
                </Pill>
              </div>
              <div style={{ display: "grid", gap: 8 }}>
                {incomplete.map((t) => (
                  <Row key={t.id} t={t} />
                ))}
              </div>
            </>
          ) : (
            <Card style={{ boxShadow: "var(--shadow-sm)", background: "rgba(37, 99, 235, 0.04)" }}>
              <div style={{ fontWeight: 950 }}>All complete</div>
              <div style={{ color: "var(--muted)", marginTop: 6 }}>You can repeat sessions for more hours and fluency.</div>
            </Card>
          )}

          {complete.length ? (
            <Collapse title={`Completed (${complete.length})`} defaultOpen={false}>
              <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
                {complete.map((t) => (
                  <Row key={t.id} t={t} />
                ))}
              </div>
            </Collapse>
          ) : null}
        </div>

        <div style={{ height: 12 }} />
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <Button variant="soft" onClick={props.onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}

function Toast(props: { msg: string }) {
  return (
    <div
      style={{
        position: "fixed",
        left: "50%",
        bottom: 22,
        transform: "translateX(-50%)",
        padding: "10px 12px",
        borderRadius: 14,
        border: "1px solid var(--border)",
        background: "rgba(255,255,255,0.9)",
        boxShadow: "var(--shadow-lg)",
        fontWeight: 800,
      }}
    >
      {props.msg}
    </div>
  );
}

/* =========================
   Styles
========================= */

const cardStyle: React.CSSProperties = {
  borderRadius: 18,
  border: "1px solid var(--border)",
  background: "rgba(255,255,255,0.72)",
  boxShadow: "var(--shadow-lg)",
  padding: 14,
};

const primaryButtonStyle: React.CSSProperties = {
  border: "1px solid rgba(37, 99, 235, 0.25)",
  background: "linear-gradient(180deg, rgba(37, 99, 235, 0.85), rgba(37, 99, 235, 0.65))",
  color: "white",
  borderRadius: 16,
  padding: "12px 14px",
  fontWeight: 950,
  letterSpacing: "-0.01em",
  boxShadow: "0 10px 30px rgba(37, 99, 235, 0.18), var(--shadow-sm)",
};

const softButtonStyle: React.CSSProperties = {
  border: "1px solid var(--border)",
  background: "rgba(255,255,255,0.6)",
  color: "var(--text)",
  borderRadius: 16,
  padding: "10px 12px",
  fontWeight: 900,
  boxShadow: "var(--shadow-sm)",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 14,
  border: "1px solid var(--border)",
  background: "rgba(255,255,255,0.75)",
  boxShadow: "var(--shadow-sm)",
  outline: "none",
  fontWeight: 700,
};

const textareaStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 14,
  border: "1px solid var(--border)",
  background: "rgba(255,255,255,0.75)",
  boxShadow: "var(--shadow-sm)",
  outline: "none",
  fontWeight: 650,
  lineHeight: 1.35,
};

const textareaStyleMono: React.CSSProperties = {
  ...textareaStyle,
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  fontSize: 12,
  whiteSpace: "pre-wrap",
};

const levelRowStyle: React.CSSProperties = {
  width: "100%",
  textAlign: "left",
  padding: 12,
  borderRadius: 18,
  border: "1px solid var(--border)",
  background: "rgba(255,255,255,0.55)",
  boxShadow: "var(--shadow-sm)",
  cursor: "pointer",
};