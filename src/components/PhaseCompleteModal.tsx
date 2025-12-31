import React from "react";

export function PhaseCompleteModal(props: {
  open: boolean;
  phaseLabel: string;
  onNext: () => void;
  onAdd2: () => void;
  onAdd5: () => void;
  onEndEarly: () => void;
}) {
  if (!props.open) return null;

  return (
    <div style={styles.backdrop}>
      <div style={styles.card} role="dialog" aria-modal="true">
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>Phase Complete</div>
        <div style={{ opacity: 0.8, marginBottom: 14 }}>{props.phaseLabel}</div>

        <div style={styles.btnCol}>
          <button style={styles.primary} onClick={props.onNext}>
            Start next phase
          </button>

          <div style={styles.row}>
            <button style={styles.secondary} onClick={props.onAdd2}>
              Add two minutes
            </button>
            <button style={styles.secondary} onClick={props.onAdd5}>
              Add five minutes
            </button>
          </div>

          <button style={styles.danger} onClick={props.onEndEarly}>
            End session early
          </button>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.45)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    zIndex: 50,
  },
  card: {
    width: "100%",
    maxWidth: 520,
    background: "white",
    borderRadius: 14,
    padding: 16,
    boxShadow: "0 10px 30px rgba(0,0,0,0.2)",
  },
  btnCol: { display: "flex", flexDirection: "column", gap: 10 },
  row: { display: "flex", gap: 10 },
  primary: {
    padding: "12px 14px",
    borderRadius: 12,
    border: "1px solid #111",
    background: "#111",
    color: "white",
    fontWeight: 700,
  },
  secondary: {
    flex: 1,
    padding: "12px 14px",
    borderRadius: 12,
    border: "1px solid rgba(0,0,0,0.2)",
    background: "white",
    fontWeight: 600,
  },
  danger: {
    padding: "12px 14px",
    borderRadius: 12,
    border: "1px solid rgba(200,0,0,0.25)",
    background: "rgba(200,0,0,0.06)",
    color: "rgb(140,0,0)",
    fontWeight: 700,
  },
};
