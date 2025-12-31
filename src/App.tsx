import { useEffect, useMemo, useRef, useState } from "react";
import { STARTER_TEMPLATES, PHASES_FIXED } from "./data/starterTemplates";
import type { PartnerMode, PhaseKey, Template } from "./data/starterTemplates";
import { kvGet, kvSet } from "./lib/storage";
import { playChime } from "./lib/chime";
import { copyText } from "./lib/clipboard";
import { PhaseCompleteModal } from "./components/PhaseCompleteModal";

type Settings = {
  autopauseBetweenPhases: boolean;
  chimeSounds: boolean;
  oneMinuteWarning: boolean;
};

type View = "home" | "preview" | "runner";

type SessionState = {
  templateId: string;
  partnerMode: PartnerMode;

  phaseIndex: number;
  phasesRun: Array<{ key: PhaseKey; label: string; totalSeconds: number }>;

  running: boolean;
  timeLeftSeconds: number;

  helperVisible: boolean;

  twistAvailable: boolean;
  twistUsed: boolean;
  twistOpen: boolean;

  startedAtIso: string;
};

const DEFAULT_SETTINGS: Settings = {
  autopauseBetweenPhases: true,
  chimeSounds: true,
  oneMinuteWarning: false,
};

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function formatMMSS(totalSeconds: number) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${pad2(m)}:${pad2(s)}`;
}

function buildPhasesRun(hasReview: boolean) {
  return PHASES_FIXED.filter((p) => (p.key === "review" ? hasReview : true)).map((p) => ({
    key: p.key,
    label: p.label,
    totalSeconds: p.defaultSeconds,
  }));
}

function buildAiHelperPrompt(t: Template) {
  return [
    "You are the Helper in a simulation-based speaking practice session.",
    "Rules:",
    "- This is simulation, not role play. The learner is always themselves.",
    "- Fluency before accuracy. Do not correct during phases until the end.",
    "- Corrections are delayed until the Record for Correction phase.",
    "",
    `Template: ${t.title}`,
    "",
    `Outcome: ${t.outcome}`,
    `Restrictions:\n- ${t.restrictions.join("\n- ")}`,
    `Procedure:\n- ${t.procedure.join("\n- ")}`,
    "",
    `Helper Card:\n${t.helperCard}`,
    "",
    `Hidden Information (do not show learner):\n${t.hiddenInformation}`,
    "",
    `Mandatory Objections (use at least two):\n- ${t.mandatoryObjections.join("\n- ")}`,
    "",
    `Twist (trigger once when available):\n${t.twist.wording}`,
  ].join("\n");
}

function buildFullSessionPrompt(t: Template) {
  return [
    "Run a perfect-hour simulation-based speaking session.",
    "Rules:",
    "- Simulation, not role play. Learner is always themselves.",
    "- Real outcomes, negotiation, constraints.",
    "- Fluency before accuracy; no corrections until the end.",
    "- Corrections only in Record for Correction: selective recasts + high-value fixes.",
    "",
    `Template: ${t.title}`,
    "",
    `Outcome: ${t.outcome}`,
    `Restrictions:\n- ${t.restrictions.join("\n- ")}`,
    `Procedure:\n- ${t.procedure.join("\n- ")}`,
    "",
    `Learner Card:\n${t.learnerCard}`,
    "",
    `Helper Card:\n${t.helperCard}`,
    "",
    `Hidden Information (helper only):\n${t.hiddenInformation}`,
    "",
    `Mandatory Objections:\n- ${t.mandatoryObjections.join("\n- ")}`,
    "",
    `Twist (helper triggers once when available):\n${t.twist.wording}`,
    "",
    "Phase scripts:",
    `Fluency: ${t.sessionScript.fluency}`,
    `Input: ${t.sessionScript.input}`,
    `Simulation: ${t.sessionScript.simulation}`,
    `Record for Correction: ${t.sessionScript.record}`,
  ].join("\n");
}

function nowIso() {
  return new Date().toISOString();
}

export default function App() {
  const [view, setView] = useState<View>("home");

  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [partnerMode, setPartnerMode] = useState<PartnerMode>("human");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(STARTER_TEMPLATES[0]?.id ?? "");

  const [session, setSession] = useState<SessionState | null>(null);
  const [phaseCompleteOpen, setPhaseCompleteOpen] = useState(false);
  const [endEarlyConfirmOpen, setEndEarlyConfirmOpen] = useState(false);
  const warnedRef = useRef(false);

  // Preview-only UI state
  const [previewHelperVisible, setPreviewHelperVisible] = useState(false);

  const template = useMemo(() => {
    return STARTER_TEMPLATES.find((t) => t.id === (session?.templateId ?? selectedTemplateId)) ?? STARTER_TEMPLATES[0];
  }, [session?.templateId, selectedTemplateId]);

  const currentPhase = useMemo(() => {
    if (!session) return null;
    return session.phasesRun[session.phaseIndex] ?? null;
  }, [session]);

  // load settings
  useEffect(() => {
    (async () => {
      const s = await kvGet<Settings>("settings", DEFAULT_SETTINGS);
      setSettings(s);
      const pm = await kvGet<PartnerMode>("partnerMode", "human");
      setPartnerMode(pm);
      const tid = await kvGet<string>("selectedTemplateId", STARTER_TEMPLATES[0]?.id ?? "");
      setSelectedTemplateId(tid);
    })();
  }, []);

  // persist settings
  useEffect(() => {
    kvSet("settings", settings);
  }, [settings]);

  useEffect(() => {
    kvSet("partnerMode", partnerMode);
  }, [partnerMode]);

  useEffect(() => {
    kvSet("selectedTemplateId", selectedTemplateId);
  }, [selectedTemplateId]);

  // timer tick
  useEffect(() => {
    if (!session?.running) return;

    const id = window.setInterval(() => {
      setSession((prev) => {
        if (!prev || !prev.running) return prev;

        const next = Math.max(0, prev.timeLeftSeconds - 1);

        // one-minute warning (optional)
        if (settings.oneMinuteWarning && !warnedRef.current && next === 60) {
          warnedRef.current = true;
          if (settings.chimeSounds) playChime();
        }

        // twist availability: only in simulation phase
        const phaseKey = prev.phasesRun[prev.phaseIndex]?.key;
        let twistAvailable = prev.twistAvailable;

        if (phaseKey === "simulation" && !prev.twistUsed) {
          const total = prev.phasesRun[prev.phaseIndex]?.totalSeconds ?? 0;
          const elapsed = total - next;
          const ruleGate = Math.max(5 * 60, template.twist.triggerAfterSeconds);
          if (elapsed >= ruleGate) twistAvailable = true;
        }

        // phase end
        if (next === 0) {
          if (settings.chimeSounds) playChime();

          const shouldAutopause = settings.autopauseBetweenPhases;
          window.setTimeout(() => setPhaseCompleteOpen(true), 150);

          return { ...prev, timeLeftSeconds: 0, running: shouldAutopause ? false : prev.running, twistAvailable };
        }

        return { ...prev, timeLeftSeconds: next, twistAvailable };
      });
    }, 1000);

    return () => window.clearInterval(id);
  }, [
    session?.running,
    settings.oneMinuteWarning,
    settings.chimeSounds,
    settings.autopauseBetweenPhases,
    template.twist.triggerAfterSeconds,
  ]);

  function startSession() {
    // baseline: review always skipped because we have no stored “review items” yet.
    const hasReview = false;

    const phasesRun = buildPhasesRun(hasReview);
    const firstRealPhaseIndex = 0;

    const first = phasesRun[firstRealPhaseIndex];

    warnedRef.current = false;

    const s: SessionState = {
      templateId: selectedTemplateId,
      partnerMode,

      phaseIndex: firstRealPhaseIndex,
      phasesRun,

      running: true,
      timeLeftSeconds: first.totalSeconds,

      helperVisible: false,

      twistAvailable: false,
      twistUsed: false,
      twistOpen: false,

      startedAtIso: nowIso(),
    };

    setSession(s);
    setView("runner");
  }

  function toggleRun() {
    if (!session) return;
    warnedRef.current = false;
    setSession({ ...session, running: !session.running });
  }

  function goHome() {
    setPhaseCompleteOpen(false);
    setEndEarlyConfirmOpen(false);
    setSession(null);
    setView("home");
  }

  function nextPhase() {
    if (!session) return;
    setPhaseCompleteOpen(false);
    warnedRef.current = false;

    const nextIndex = Math.min(session.phaseIndex + 1, session.phasesRun.length - 1);

    // if already at last phase and it's complete, end session (baseline: go home)
    if (nextIndex === session.phaseIndex && session.timeLeftSeconds === 0) {
      goHome();
      return;
    }

    const nextP = session.phasesRun[nextIndex];
    setSession({
      ...session,
      phaseIndex: nextIndex,
      timeLeftSeconds: nextP.totalSeconds,
      running: true,
      helperVisible: false,
      twistOpen: false,
    });
  }

  function addSeconds(delta: number) {
    if (!session) return;
    setPhaseCompleteOpen(false);
    warnedRef.current = false;

    setSession({
      ...session,
      timeLeftSeconds: session.timeLeftSeconds + delta,
      running: true,
    });
  }

  function requestEndEarly() {
    setEndEarlyConfirmOpen(true);
  }

  function confirmEndEarly() {
    setEndEarlyConfirmOpen(false);
    goHome();
  }

  async function copyAiHelper() {
    if (!template) return;
    const ok = await copyText(buildAiHelperPrompt(template));
    alert(ok ? "Copied AI Helper prompt." : "Copy failed.");
  }

  async function copyFullPrompt() {
    if (!template) return;
    const ok = await copyText(buildFullSessionPrompt(template));
    alert(ok ? "Copied full session prompt." : "Copy failed.");
  }

  function openTwist() {
    if (!session) return;
    if (!session.twistAvailable || session.twistUsed) return;
    setSession({ ...session, twistOpen: true });
  }

  function applyTwistUsed() {
    if (!session) return;
    setSession({ ...session, twistOpen: false, twistUsed: true });
  }

  if (view === "home") {
    return (
      <div style={ui.page}>
        <div style={ui.header}>
          <div style={ui.title}>Simulation Perfect Hour</div>
          <div style={ui.subtitle}>Local-first • calm • simulation-based speaking</div>
        </div>

        <div style={ui.card}>
          <div style={ui.sectionTitle}>Partner Mode</div>
          <div style={ui.row}>
            <button style={partnerMode === "human" ? ui.pillActive : ui.pill} onClick={() => setPartnerMode("human")}>
              Human
            </button>
            <button style={partnerMode === "ai" ? ui.pillActive : ui.pill} onClick={() => setPartnerMode("ai")}>
              AI (copy/paste)
            </button>
          </div>
        </div>

        <div style={ui.card}>
          <div style={ui.sectionTitle}>Settings</div>
          <label style={ui.toggle}>
            <input
              type="checkbox"
              checked={settings.autopauseBetweenPhases}
              onChange={(e) => setSettings({ ...settings, autopauseBetweenPhases: e.target.checked })}
            />
            <span>Autopause between phases (default on)</span>
          </label>
          <label style={ui.toggle}>
            <input
              type="checkbox"
              checked={settings.chimeSounds}
              onChange={(e) => setSettings({ ...settings, chimeSounds: e.target.checked })}
            />
            <span>Chime sounds (default on)</span>
          </label>
          <label style={ui.toggle}>
            <input
              type="checkbox"
              checked={settings.oneMinuteWarning}
              onChange={(e) => setSettings({ ...settings, oneMinuteWarning: e.target.checked })}
            />
            <span>One-minute warning (default off)</span>
          </label>
        </div>

        <div style={ui.card}>
          <div style={ui.sectionTitle}>Template</div>
          <select style={ui.select} value={selectedTemplateId} onChange={(e) => setSelectedTemplateId(e.target.value)}>
            {STARTER_TEMPLATES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title} {t.locked ? "• locked" : ""}
              </option>
            ))}
          </select>

          <div style={{ marginTop: 10, opacity: 0.85, fontSize: 13 }}>
            Baseline ships with one locked starter template. You’ll add duplication + editing next.
          </div>
        </div>

        <button
          style={ui.primary}
          onClick={() => {
            setPreviewHelperVisible(false);
            setView("preview");
          }}
        >
          Preview Session
        </button>

        <div style={{ opacity: 0.7, fontSize: 12, marginTop: 12 }}>
          Tip: Preview first. Start the timer only when you’re ready to speak.
        </div>
      </div>
    );
  }

  if (view === "preview") {
    return (
      <div style={ui.page}>
        <div style={ui.header}>
          <div style={ui.title}>Preview</div>
          <div style={ui.subtitle}>
            Template: {template?.title} • Mode: {partnerMode}
          </div>
        </div>

        <div style={ui.card}>
          <div style={ui.sectionTitle}>Outcome</div>
          <div style={ui.textBox}>{template.outcome}</div>
        </div>

        <div style={ui.card}>
          <div style={ui.sectionTitle}>Restrictions</div>
          <div style={ui.textBox}>- {template.restrictions.join("\n- ")}</div>
        </div>

        <div style={ui.card}>
          <div style={ui.sectionTitle}>Procedure</div>
          <div style={ui.textBox}>- {template.procedure.join("\n- ")}</div>
        </div>

        <div style={ui.card}>
          <div style={ui.sectionTitle}>Learner card (always visible)</div>
          <div style={ui.textBox}>{template.learnerCard}</div>
        </div>

        <div style={ui.card}>
          <div style={ui.rowBetween}>
            <div style={ui.sectionTitle}>Helper info</div>
            <button style={previewHelperVisible ? ui.pillActive : ui.pill} onClick={() => setPreviewHelperVisible((v) => !v)}>
              {previewHelperVisible ? "Shown" : "Hidden"}
            </button>
          </div>

          {previewHelperVisible ? (
            <>
              <div style={{ marginTop: 10, fontSize: 13, opacity: 0.85 }}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>Helper card</div>
                <div style={ui.textBox}>{template.helperCard}</div>
              </div>

              <div style={{ marginTop: 10, fontSize: 13, opacity: 0.85 }}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>Hidden information</div>
                <div style={ui.textBox}>{template.hiddenInformation}</div>
              </div>

              <div style={{ marginTop: 10, fontSize: 13, opacity: 0.85 }}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>Mandatory objections</div>
                <div style={ui.textBox}>- {template.mandatoryObjections.join("\n- ")}</div>
              </div>

              <div style={{ marginTop: 10, fontSize: 13, opacity: 0.85 }}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>Twist (exact wording)</div>
                <div style={ui.textBox}>{template.twist.wording}</div>
              </div>
            </>
          ) : (
            <div style={{ opacity: 0.7, fontSize: 13 }}>Hidden by default (calm). Toggle only if you want to preview it.</div>
          )}
        </div>

        {partnerMode === "ai" && (
          <div style={ui.card}>
            <div style={ui.sectionTitle}>AI mode</div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button style={ui.secondary} onClick={copyAiHelper}>
                Copy AI Helper Prompt
              </button>
              <button style={ui.secondary} onClick={copyFullPrompt}>
                Copy Full Session Prompt
              </button>
            </div>
          </div>
        )}

        <div style={{ display: "flex", gap: 10 }}>
          <button style={ui.secondary} onClick={() => setView("home")}>
            Back
          </button>
          <button style={ui.primarySmall} onClick={startSession}>
            Start Timer
          </button>
        </div>

        <div style={{ opacity: 0.7, fontSize: 12, marginTop: 12 }}>
          Timer starts at Fluency. Review auto-skips until we add history and saved corrections.
        </div>
      </div>
    );
  }

  // runner view
  return (
    <div style={ui.page}>
      <div style={ui.header}>
        <div style={ui.title}>Runner</div>
        <div style={ui.subtitle}>
          Template: {template?.title} • Mode: {session?.partnerMode}
        </div>
      </div>

      <div style={ui.card}>
        <div style={ui.rowBetween}>
          <div>
            <div style={{ fontSize: 14, opacity: 0.8 }}>Current phase</div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{currentPhase?.label ?? "—"}</div>
          </div>
          <div style={{ fontSize: 28, fontWeight: 800 }}>{formatMMSS(session?.timeLeftSeconds ?? 0)}</div>
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
          <button style={ui.secondary} onClick={toggleRun}>
            {session?.running ? "Pause" : "Resume"}
          </button>
          <button style={ui.secondary} onClick={goHome}>
            End / Home
          </button>
        </div>

        {currentPhase?.key === "simulation" && (
          <div style={{ marginTop: 12 }}>
            <button
              style={session?.twistAvailable && !session?.twistUsed ? ui.primarySmall : ui.disabled}
              onClick={openTwist}
              disabled={!session?.twistAvailable || !!session?.twistUsed}
            >
              {session?.twistUsed ? "Twist used" : session?.twistAvailable ? "Trigger twist (one time)" : "Twist locked"}
            </button>

            {session?.twistOpen && (
              <div style={ui.twistBox}>
                <div style={{ fontWeight: 800, marginBottom: 6 }}>Twist (exact wording)</div>
                <div style={{ whiteSpace: "pre-wrap" }}>{template.twist.wording}</div>
                <button style={ui.primarySmall} onClick={applyTwistUsed}>
                  Mark twist as used
                </button>
              </div>
            )}

            <div style={{ marginTop: 6, fontSize: 12, opacity: 0.75 }}>
              Twist unlocks after five minutes or template trigger, whichever is later. Single-use.
            </div>
          </div>
        )}
      </div>

      <div style={ui.card}>
        <div style={ui.sectionTitle}>Learner card (always visible)</div>
        <div style={ui.textBox}>{template.learnerCard}</div>
      </div>

      <div style={ui.card}>
        <div style={ui.rowBetween}>
          <div style={ui.sectionTitle}>Helper card</div>
          <button
            style={ui.pill}
            onClick={() => setSession((s) => (s ? { ...s, helperVisible: !s.helperVisible } : s))}
          >
            {session?.helperVisible ? "Hide" : "Show"}
          </button>
        </div>

        {session?.helperVisible ? (
          <>
            <div style={ui.textBox}>{template.helperCard}</div>
            <div style={{ marginTop: 10, fontSize: 13, opacity: 0.85 }}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>Hidden information</div>
              <div style={ui.textBox}>{template.hiddenInformation}</div>
            </div>
            <div style={{ marginTop: 10, fontSize: 13, opacity: 0.85 }}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>Mandatory objections</div>
              <div style={ui.textBox}>- {template.mandatoryObjections.join("\n- ")}</div>
            </div>
          </>
        ) : (
          <div style={{ opacity: 0.7, fontSize: 13 }}>Hidden by default (Human mode friendly).</div>
        )}

        {session?.partnerMode === "ai" && (
          <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button style={ui.secondary} onClick={copyAiHelper}>
              Copy AI Helper Prompt
            </button>
            <button style={ui.secondary} onClick={copyFullPrompt}>
              Copy Full Session Prompt
            </button>
          </div>
        )}
      </div>

      <div style={ui.card}>
        <div style={ui.sectionTitle}>Phase script</div>
        <div style={ui.textBox}>
          {currentPhase?.key === "fluency" && template.sessionScript.fluency}
          {currentPhase?.key === "input" && template.sessionScript.input}
          {currentPhase?.key === "simulation" && template.sessionScript.simulation}
          {currentPhase?.key === "record" && template.sessionScript.record}
        </div>
      </div>

      <PhaseCompleteModal
        open={phaseCompleteOpen}
        phaseLabel={currentPhase?.label ?? "Phase"}
        onNext={nextPhase}
        onAdd2={() => addSeconds(2 * 60)}
        onAdd5={() => addSeconds(5 * 60)}
        onEndEarly={requestEndEarly}
      />

      {endEarlyConfirmOpen && (
        <div style={ui.backdrop}>
          <div style={ui.confirmCard} role="dialog" aria-modal="true">
            <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 8 }}>End session early?</div>
            <div style={{ opacity: 0.85, marginBottom: 12 }}>
              This will stop the session and return to Home (baseline does not save history yet).
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button style={ui.secondary} onClick={() => setEndEarlyConfirmOpen(false)}>
                Cancel
              </button>
              <button style={ui.primarySmall} onClick={confirmEndEarly}>
                End now
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const ui: Record<string, React.CSSProperties> = {
  page: {
    maxWidth: 720,
    margin: "0 auto",
    padding: 16,
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
  },
  header: { marginTop: 8, marginBottom: 12 },
  title: { fontSize: 24, fontWeight: 900 },
  subtitle: { opacity: 0.7, marginTop: 4 },

  card: {
    background: "white",
    border: "1px solid rgba(0,0,0,0.08)",
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
  },
  sectionTitle: { fontSize: 14, fontWeight: 800, marginBottom: 8 },
  row: { display: "flex", gap: 10 },
  rowBetween: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 },

  pill: {
    padding: "8px 10px",
    borderRadius: 999,
    border: "1px solid rgba(0,0,0,0.2)",
    background: "white",
    fontWeight: 700,
  },
  pillActive: {
    padding: "8px 10px",
    borderRadius: 999,
    border: "1px solid #111",
    background: "#111",
    color: "white",
    fontWeight: 800,
  },

  toggle: { display: "flex", gap: 10, alignItems: "center", marginTop: 8 },

  select: { width: "100%", padding: "10px 12px", borderRadius: 12, border: "1px solid rgba(0,0,0,0.15)" },

  primary: {
    width: "100%",
    padding: "14px 14px",
    borderRadius: 14,
    border: "1px solid #111",
    background: "#111",
    color: "white",
    fontWeight: 900,
    fontSize: 16,
  },
  primarySmall: {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid #111",
    background: "#111",
    color: "white",
    fontWeight: 900,
  },
  secondary: {
    padding: "12px 12px",
    borderRadius: 12,
    border: "1px solid rgba(0,0,0,0.18)",
    background: "white",
    fontWeight: 800,
  },
  disabled: {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(0,0,0,0.12)",
    background: "rgba(0,0,0,0.03)",
    color: "rgba(0,0,0,0.35)",
    fontWeight: 800,
  },

  textBox: {
    whiteSpace: "pre-wrap",
    background: "rgba(0,0,0,0.03)",
    border: "1px solid rgba(0,0,0,0.06)",
    borderRadius: 12,
    padding: 12,
    lineHeight: 1.35,
  },

  twistBox: {
    marginTop: 10,
    background: "rgba(255,200,0,0.12)",
    border: "1px solid rgba(255,180,0,0.35)",
    borderRadius: 12,
    padding: 12,
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },

  backdrop: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.45)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    zIndex: 60,
  },
  confirmCard: {
    width: "100%",
    maxWidth: 520,
    background: "white",
    borderRadius: 14,
    padding: 16,
    boxShadow: "0 10px 30px rgba(0,0,0,0.2)",
  },
};
