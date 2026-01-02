import { useEffect, useMemo, useState } from 'react';
import { parsePerfectHourLibrary, PerfectHourSession } from './utils/parsePerfectHour';
import { buildCopyForAIText } from './utils/copyForAI';
import { copyToClipboard } from './utils/clipboard';

type View = 'home' | 'session';

type Toast = { message: string; kind?: 'ok' | 'error' } | null;

function formatTime(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  // We intentionally show minute-level time (no seconds) so it feels calm.
  const totalMins = Math.max(0, Math.ceil(s / 60));
  const days = Math.floor(totalMins / (60 * 24));
  const hours = Math.floor((totalMins % (60 * 24)) / 60);
  const mins = totalMins % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

export default function App() {
  const [view, setView] = useState<View>('home');
  const [sessions, setSessions] = useState<PerfectHourSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [toast, setToast] = useState<Toast>(null);

  const [targetLanguageName, setTargetLanguageName] = useState<string>(() => {
    return localStorage.getItem('fh_targetLanguageName') ?? '';
  });

  // Timer state
  const [phaseIndex, setPhaseIndex] = useState(0); // 0-based
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [running, setRunning] = useState(false);

  const selected = useMemo(() => sessions.find((s) => s.id === selectedId) ?? null, [sessions, selectedId]);
  const currentPhase = useMemo(() => {
    if (!selected) return null;
    return selected.phases[phaseIndex] ?? null;
  }, [selected, phaseIndex]);

  useEffect(() => {
    localStorage.setItem('fh_targetLanguageName', targetLanguageName);
  }, [targetLanguageName]);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const resp = await fetch('/library/perfect-hour-data.txt', { cache: 'no-store' });
        if (!resp.ok) throw new Error(`Failed to load library: ${resp.status}`);
        const text = await resp.text();
        const parsed = parsePerfectHourLibrary(text);
        setSessions(parsed);
        if (!selectedId && parsed.length) setSelectedId(parsed[0].id);
        setError(null);
      } catch (e: any) {
        setError(e?.message ?? 'Failed to load library');
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reset timer when session changes
  useEffect(() => {
    if (!selected) return;
    setPhaseIndex(0);
    setRunning(false);
    const first = selected.phases[0];
    setSecondsLeft((first?.minutes ?? 0) * 60);
  }, [selectedId]);

  // Tick timer
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          window.clearInterval(t);
          setRunning(false);
          setToast({ message: 'Phase complete.', kind: 'ok' });
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(t);
  }, [running]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 2200);
    return () => window.clearTimeout(t);
  }, [toast]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((s) => {
      const hay = `${s.title} ${s.level ?? ''} ${s.context ?? ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [sessions, search]);

  async function onCopySessionForAI() {
    if (!selected) return;
    try {
      const text = buildCopyForAIText({ session: selected, targetLanguageName });
      await copyToClipboard(text);
      setToast({ message: 'Copied for AI.', kind: 'ok' });
    } catch (e: any) {
      setToast({ message: e?.message ?? 'Copy failed', kind: 'error' });
    }
  }

  function goToSession(sessionId: string) {
    setSelectedId(sessionId);
    setView('session');
  }

  function onQuickStart() {
    const first = filtered[0] ?? sessions[0];
    if (first) goToSession(first.id);
  }

  function nextPhase() {
    if (!selected) return;
    const next = Math.min(selected.phases.length - 1, phaseIndex + 1);
    setPhaseIndex(next);
    setRunning(false);
    const ph = selected.phases[next];
    setSecondsLeft((ph?.minutes ?? 0) * 60);
  }

  function prevPhase() {
    if (!selected) return;
    const prev = Math.max(0, phaseIndex - 1);
    setPhaseIndex(prev);
    setRunning(false);
    const ph = selected.phases[prev];
    setSecondsLeft((ph?.minutes ?? 0) * 60);
  }

  return (
    <div>
      <header className="fh-header">
        <div className="fh-header-inner">
          <div className="fh-header-top">
            <div className="fh-brand">
              <div
                className="fh-brand-icon"
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 12,
                  border: '1px solid rgba(15,23,42,.12)',
                  background: 'linear-gradient(180deg, rgba(37,99,235,.18), rgba(255,255,255,.9))',
                  display: 'grid',
                  placeItems: 'center',
                  fontWeight: 900,
                }}
              >
                FH
              </div>
              <div>
                <div className="fh-brand-title" style={{ fontSize: 18, fontWeight: 900, letterSpacing: '-.02em' }}>
                  FluentHour
                </div>
                <div className="fh-brand-subtitle" style={{ fontSize: 12, color: 'var(--muted)' }}>
                  CEFR · ACTFL · Canadian Language Benchmarks informed
                </div>
              </div>
            </div>

            <div className="fh-header-controls">
              {view === 'session' ? (
                <button className="fh-menu-button" onClick={() => setView('home')} title="Back">
                  ← Library
                </button>
              ) : null}

              {view === 'session' ? (
                <button className="fh-menu-button" onClick={onCopySessionForAI} title="Copy prompt + session for AI">
                  Copy for AI
                </button>
              ) : null}
            </div>
          </div>

          <div className="fh-header-progress">
            <div className="fh-progress-text">
              <span>{selected ? selected.level ?? 'Session' : 'Library'}</span>
              <span>{selected ? `Phase ${Math.min(phaseIndex + 1, selected.phases.length)} / ${selected.phases.length}` : ''}</span>
            </div>
            <div className="fh-progress-bar">
              <div
                style={{
                  height: '100%',
                  width: selected ? `${(100 * (phaseIndex + 1)) / Math.max(1, selected.phases.length)}%` : '0%',
                  background: 'linear-gradient(90deg, rgba(37,99,235,.9), rgba(37,99,235,.35))',
                }}
              />
            </div>
          </div>
        </div>
      </header>

      <main className="fh-container">
        {loading ? (
          <div className="fh-card">Loading library…</div>
        ) : error ? (
          <div className="fh-card">
            <div style={{ fontWeight: 850, marginBottom: 6 }}>Library failed to load</div>
            <div className="fh-text-muted">{error}</div>
          </div>
        ) : view === 'home' ? (
          <>
            <div className="fh-card">
              <div className="fh-card-header">
                <div>
                  <div style={{ fontWeight: 900, fontSize: 18, letterSpacing: '-.02em' }}>Start a session</div>
                  <div className="fh-text-muted">Pick a session, then use “Copy for AI” to run it with a language helper AI.</div>
                </div>
                <span className="fh-pill">{sessions.length} sessions</span>
              </div>

              <button className="fh-primary-button" onClick={onQuickStart}>
                Quick start
              </button>

              <div className="fh-stats-row">
                <div style={{ flex: 1, minWidth: 220 }}>
                  <div className="fh-text-muted" style={{ marginBottom: 6 }}>
                    Target language (used in “Copy for AI”)
                  </div>
                  <input
                    type="text"
                    value={targetLanguageName}
                    onChange={(e) => setTargetLanguageName(e.target.value)}
                    placeholder="e.g., French"
                    style={{ width: '100%' }}
                  />
                </div>
                <div style={{ flex: 1, minWidth: 220 }}>
                  <div className="fh-text-muted" style={{ marginBottom: 6 }}>
                    Search
                  </div>
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Filter by title, level, or context"
                    style={{ width: '100%' }}
                  />
                </div>
              </div>
            </div>

            {filtered.slice(0, 40).map((s) => (
              <button key={s.id} className="fh-card fh-card--subtle" onClick={() => goToSession(s.id)} style={{ textAlign: 'left' }}>
                <div className="fh-card-header" style={{ marginBottom: 6 }}>
                  <div style={{ fontWeight: 850, letterSpacing: '-.01em' }}>{s.title}</div>
                  <span className="fh-pill">{s.level ? s.level.split('(')[0].trim() : 'Session'}</span>
                </div>
                <div className="fh-text-muted fh-text-truncate">{s.context ?? ''}</div>
              </button>
            ))}

            {filtered.length > 40 ? (
              <div className="fh-text-muted" style={{ padding: '0 6px' }}>
                Showing the first 40 results. Refine your search to narrow it down.
              </div>
            ) : null}
          </>
        ) : selected && currentPhase ? (
          <>
            <div className="fh-card">
              <div className="fh-card-header">
                <div>
                  <div style={{ fontWeight: 900, fontSize: 18, letterSpacing: '-.02em' }}>{selected.title}</div>
                  <div className="fh-text-muted">{selected.context ?? ''}</div>
                </div>
                <span className="fh-pill">{selected.level ?? 'Level'}</span>
              </div>

              <div className="fh-stats-row">
                <div>
                  <div className="fh-text-muted">Time left</div>
                  <div className="fh-timer">{formatTime(secondsLeft)}</div>
                </div>
                <div className="fh-button-group">
                  <button className="fh-menu-button" onClick={() => setRunning((r) => !r)}>
                    {running ? 'Pause' : 'Start'}
                  </button>
                  <button className="fh-menu-button" onClick={prevPhase} disabled={phaseIndex === 0} style={{ opacity: phaseIndex === 0 ? 0.6 : 1 }}>
                    Previous
                  </button>
                  <button
                    className="fh-menu-button"
                    onClick={nextPhase}
                    disabled={phaseIndex >= selected.phases.length - 1}
                    style={{ opacity: phaseIndex >= selected.phases.length - 1 ? 0.6 : 1 }}
                  >
                    Next
                  </button>
                </div>
              </div>
            </div>

            <div className="fh-card">
              <div className="fh-card-header">
                <div>
                  <div style={{ fontWeight: 900, fontSize: 16, letterSpacing: '-.02em' }}>
                    Phase {currentPhase.index}: {currentPhase.name}
                  </div>
                  <div className="fh-text-muted">{currentPhase.minutes} minutes</div>
                </div>
                <span className="fh-pill">Learner</span>
              </div>

              {selected.correction ? (
                <div className="fh-text-muted" style={{ marginBottom: 10 }}>
                  <strong>Correction focus:</strong> {selected.correction}
                </div>
              ) : null}

              <div style={{ display: 'grid', gap: 8 }}>
                {(currentPhase.steps ?? []).map((step, idx) => (
                  <div key={idx} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <div className="fh-pill" style={{ padding: '4px 8px' }}>
                      {idx + 1}
                    </div>
                    <div style={{ lineHeight: 1.35 }}>{step}</div>
                  </div>
                ))}
              </div>
            </div>

            <details className="fh-card">
              <summary style={{ cursor: 'pointer', fontWeight: 900, listStyle: 'none' }}>
                Helper (shows best when paused)
              </summary>
              <div className="fh-text-muted" style={{ marginTop: 10 }}>
                If you are using an AI as your helper, use the “Copy for AI” button in the header.
              </div>
              {currentPhase.helperScript ? (
                <div style={{ marginTop: 10, whiteSpace: 'pre-wrap', lineHeight: 1.45 }}>
                  {currentPhase.helperScript}
                </div>
              ) : (
                <div className="fh-text-muted" style={{ marginTop: 10 }}>
                  No helper script for this phase.
                </div>
              )}
            </details>
          </>
        ) : (
          <div className="fh-card">Select a session from the library.</div>
        )}
      </main>

      {toast ? (
        <div
          style={{
            position: 'fixed',
            bottom: 16,
            left: '50%',
            transform: 'translateX(-50%)',
            padding: '10px 12px',
            borderRadius: 999,
            border: '1px solid rgba(15,23,42,.12)',
            background: 'rgba(255,255,255,.9)',
            boxShadow: 'var(--shadow)',
            fontWeight: 850,
            zIndex: 50,
            maxWidth: '92vw',
          }}
        >
          {toast.message}
        </div>
      ) : null}
    </div>
  );
}
