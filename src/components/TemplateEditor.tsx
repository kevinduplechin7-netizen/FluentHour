import { useMemo, useState } from "react";
import type { Template } from "../data/starterTemplates";

type Props = {
  template: Template;
  onCancel: () => void;
  onSave: (updated: Template) => void;
};

function linesToArray(text: string) {
  return text
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

function arrayToLines(arr: string[]) {
  return (arr ?? []).join("\n");
}

export function TemplateEditor({ template, onCancel, onSave }: Props) {
  const isLocked = template.locked;

  const [title, setTitle] = useState(template.title);
  const [level, setLevel] = useState<Template["level"]>(template.level);

  const [outcome, setOutcome] = useState(template.outcome);
  const [restrictions, setRestrictions] = useState(arrayToLines(template.restrictions));
  const [procedure, setProcedure] = useState(arrayToLines(template.procedure));

  const [learnerCard, setLearnerCard] = useState(template.learnerCard);
  const [helperCard, setHelperCard] = useState(template.helperCard);
  const [hiddenInformation, setHiddenInformation] = useState(template.hiddenInformation);

  const [mandatoryObjections, setMandatoryObjections] = useState(arrayToLines(template.mandatoryObjections));

  const [twistWording, setTwistWording] = useState(template.twist.wording);
  const [twistTriggerSeconds, setTwistTriggerSeconds] = useState<number>(template.twist.triggerAfterSeconds);

  const [scriptFluency, setScriptFluency] = useState(template.sessionScript.fluency);
  const [scriptInput, setScriptInput] = useState(template.sessionScript.input);
  const [scriptSimulation, setScriptSimulation] = useState(template.sessionScript.simulation);
  const [scriptRecord, setScriptRecord] = useState(template.sessionScript.record);

  const problems = useMemo(() => {
    const p: string[] = [];
    if (!title.trim()) p.push("Title is required.");
    if (!outcome.trim()) p.push("Outcome is required.");
    if (!learnerCard.trim()) p.push("Learner card is required.");
    if (!helperCard.trim()) p.push("Helper card is required.");
    if (!twistWording.trim()) p.push("Twist wording is required.");
    if (!Number.isFinite(twistTriggerSeconds) || twistTriggerSeconds < 0)
      p.push("Twist trigger seconds must be zero or more.");
    return p;
  }, [title, outcome, learnerCard, helperCard, twistWording, twistTriggerSeconds]);

  function handleSave() {
    if (isLocked) return;
    if (problems.length > 0) {
      alert(problems.join("\n"));
      return;
    }

    const updated: Template = {
      ...template,
      title: title.trim(),
      level,

      outcome: outcome.trim(),
      restrictions: linesToArray(restrictions),
      procedure: linesToArray(procedure),

      learnerCard,
      helperCard,
      hiddenInformation,

      mandatoryObjections: linesToArray(mandatoryObjections),

      twist: {
        wording: twistWording,
        triggerAfterSeconds: Math.floor(twistTriggerSeconds),
      },

      sessionScript: {
        fluency: scriptFluency,
        input: scriptInput,
        simulation: scriptSimulation,
        record: scriptRecord,
      },
    };

    onSave(updated);
  }

  return (
    <div style={ui.page}>
      <div style={ui.header}>
        <div style={ui.title}>Template Editor</div>
        <div style={ui.subtitle}>
          {isLocked ? "Locked (read-only)" : "Editable"} • id: {template.id}
        </div>
      </div>

      {isLocked && <div style={ui.warn}>This template is locked. Duplicate it first, then edit the copy.</div>}

      <div style={ui.card}>
        <div style={ui.sectionTitle}>Basics</div>

        <label style={ui.label}>Title</label>
        <input style={ui.input} value={title} onChange={(e) => setTitle(e.target.value)} disabled={isLocked} />

        <label style={ui.label}>Level</label>
        <select style={ui.input} value={level} onChange={(e) => setLevel(e.target.value as any)} disabled={isLocked}>
          <option value="A1">A1</option>
          <option value="A2">A2</option>
          <option value="B1">B1</option>
          <option value="B2">B2</option>
          <option value="C1">C1</option>
          <option value="C2">C2</option>
        </select>
      </div>

      <div style={ui.card}>
        <div style={ui.sectionTitle}>Outcome</div>
        <textarea style={ui.textarea} value={outcome} onChange={(e) => setOutcome(e.target.value)} disabled={isLocked} />
      </div>

      <div style={ui.card}>
        <div style={ui.sectionTitle}>Restrictions (one per line)</div>
        <textarea
          style={ui.textarea}
          value={restrictions}
          onChange={(e) => setRestrictions(e.target.value)}
          disabled={isLocked}
        />
      </div>

      <div style={ui.card}>
        <div style={ui.sectionTitle}>Procedure (one per line)</div>
        <textarea style={ui.textarea} value={procedure} onChange={(e) => setProcedure(e.target.value)} disabled={isLocked} />
      </div>

      <div style={ui.card}>
        <div style={ui.sectionTitle}>Learner card</div>
        <textarea
          style={ui.textareaTall}
          value={learnerCard}
          onChange={(e) => setLearnerCard(e.target.value)}
          disabled={isLocked}
        />
      </div>

      <div style={ui.card}>
        <div style={ui.sectionTitle}>Helper card</div>
        <textarea
          style={ui.textareaTall}
          value={helperCard}
          onChange={(e) => setHelperCard(e.target.value)}
          disabled={isLocked}
        />
      </div>

      <div style={ui.card}>
        <div style={ui.sectionTitle}>Hidden information</div>
        <textarea
          style={ui.textareaTall}
          value={hiddenInformation}
          onChange={(e) => setHiddenInformation(e.target.value)}
          disabled={isLocked}
        />
      </div>

      <div style={ui.card}>
        <div style={ui.sectionTitle}>Mandatory objections (one per line)</div>
        <textarea
          style={ui.textarea}
          value={mandatoryObjections}
          onChange={(e) => setMandatoryObjections(e.target.value)}
          disabled={isLocked}
        />
      </div>

      <div style={ui.card}>
        <div style={ui.sectionTitle}>Twist</div>

        <label style={ui.label}>Exact wording</label>
        <textarea
          style={ui.textareaTall}
          value={twistWording}
          onChange={(e) => setTwistWording(e.target.value)}
          disabled={isLocked}
        />

        <label style={ui.label}>Trigger after seconds (template rule)</label>
        <input
          style={ui.input}
          type="number"
          value={twistTriggerSeconds}
          onChange={(e) => setTwistTriggerSeconds(Number(e.target.value))}
          disabled={isLocked}
        />
      </div>

      <div style={ui.card}>
        <div style={ui.sectionTitle}>Phase scripts</div>

        <label style={ui.label}>Fluency</label>
        <textarea
          style={ui.textarea}
          value={scriptFluency}
          onChange={(e) => setScriptFluency(e.target.value)}
          disabled={isLocked}
        />

        <label style={ui.label}>Input</label>
        <textarea style={ui.textarea} value={scriptInput} onChange={(e) => setScriptInput(e.target.value)} disabled={isLocked} />

        <label style={ui.label}>Simulation</label>
        <textarea
          style={ui.textarea}
          value={scriptSimulation}
          onChange={(e) => setScriptSimulation(e.target.value)}
          disabled={isLocked}
        />

        <label style={ui.label}>Record for correction</label>
        <textarea
          style={ui.textarea}
          value={scriptRecord}
          onChange={(e) => setScriptRecord(e.target.value)}
          disabled={isLocked}
        />
      </div>

      {problems.length > 0 && (
        <div style={ui.warn}>
          <div style={{ fontWeight: 800, marginBottom: 6 }}>Fix these before saving:</div>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button style={ui.secondary} onClick={onCancel}>
          Back
        </button>
        <button style={isLocked ? ui.disabled : ui.primarySmall} onClick={handleSave} disabled={isLocked}>
          Save
        </button>
      </div>
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

  label: { display: "block", fontSize: 12, fontWeight: 800, marginTop: 10, marginBottom: 6, opacity: 0.8 },
  input: {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(0,0,0,0.15)",
    background: "white",
    fontSize: 14,
  },
  textarea: {
    width: "100%",
    minHeight: 110,
    padding: 12,
    borderRadius: 12,
    border: "1px solid rgba(0,0,0,0.15)",
    background: "white",
    fontSize: 14,
    lineHeight: 1.35,
    resize: "vertical",
  },
  textareaTall: {
    width: "100%",
    minHeight: 150,
    padding: 12,
    borderRadius: 12,
    border: "1px solid rgba(0,0,0,0.15)",
    background: "white",
    fontSize: 14,
    lineHeight: 1.35,
    resize: "vertical",
  },

  warn: {
    background: "rgba(255,200,0,0.12)",
    border: "1px solid rgba(255,180,0,0.35)",
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
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
    padding: "12px 12px",
    borderRadius: 12,
    border: "1px solid rgba(0,0,0,0.12)",
    background: "rgba(0,0,0,0.03)",
    color: "rgba(0,0,0,0.35)",
    fontWeight: 800,
  },
};
