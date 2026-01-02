export type PerfectHourPhase = {
  index: number; // 1-based
  name: string;
  minutes: number;
  purpose?: string;
  learnerRole?: string;
  helperRole?: string;
  twist?: string;
  steps: string[];
  helperScript?: string;
};

export type PerfectHourSession = {
  id: string;
  title: string;
  level?: string;
  partner?: string;
  goal?: string;
  context?: string;
  correction?: string;

  learnerRole?: string;
  helperRole?: string;
  twists?: string[];

  phases: PerfectHourPhase[];
  rawBlock: string;
};

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function parseKeyValue(line: string): { key: string; value: string } | null {
  const m = line.match(/^([A-Za-z][A-Za-z \-()]*):\s*(.+)$/);
  if (!m) return null;
  return { key: m[1].trim(), value: m[2].trim() };
}

function parseMinutesFromPhaseHeader(line: string): { idx: number; name: string; minutes: number } | null {
  // Examples:
  // PHASE 1: Fluency loop (10m)
  // PHASE 2: Model and input (20m)
  const m = line.match(/^PHASE\s+(\d+)\s*:\s*(.+?)\s*\((\d+)\s*m\)\s*$/i);
  if (!m) return null;
  return { idx: Number(m[1]), name: m[2].trim(), minutes: Number(m[3]) };
}

function splitSessions(text: string): string[] {
  const out: string[] = [];
  const re = /BEGIN PERFECT HOUR SESSION([\s\S]*?)END PERFECT HOUR SESSION/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    out.push(match[1]);
  }
  return out;
}

export function parsePerfectHourLibrary(text: string): PerfectHourSession[] {
  const blocks = splitSessions(text);
  const sessions: PerfectHourSession[] = [];

  blocks.forEach((block, blockIdx) => {
    const lines = block
      .split(/\r?\n/)
      .map((l) => l.replace(/\s+$/g, ''));

    let title = `Session ${blockIdx + 1}`;
    let level: string | undefined;
    let partner: string | undefined;
    let goal: string | undefined;
    let context: string | undefined;
    let correction: string | undefined;
    let learnerRole: string | undefined;
    let helperRole: string | undefined;
    let twists: string[] | undefined;

    const phases: PerfectHourPhase[] = [];

    let i = 0;
    while (i < lines.length) {
      const line = lines[i].trim();
      if (!line) {
        i++;
        continue;
      }

      // Phase header
      const ph = parseMinutesFromPhaseHeader(line);
      if (ph) {
        const phase: PerfectHourPhase = {
          index: ph.idx,
          name: ph.name,
          minutes: ph.minutes,
          steps: [],
        };

        i++;
        // Parse inside phase until next phase header
        while (i < lines.length) {
          const inner = lines[i].trim();
          if (!inner) {
            i++;
            continue;
          }
          if (parseMinutesFromPhaseHeader(inner)) break;

          // Bullets
          if (inner.startsWith('* ')) {
            phase.steps.push(inner.slice(2).trim());
            i++;
            continue;
          }

          // AI helper script
          if (/^AI helper script\s*:/i.test(inner)) {
            phase.helperScript = inner.replace(/^AI helper script\s*:/i, '').trim();
            i++;
            continue;
          }

          // Optional role/twist lines (phase-level)
          const kv = parseKeyValue(inner);
          if (kv) {
            const k = kv.key.toLowerCase();
            const v = kv.value;
            if (k === 'purpose') phase.purpose = v;
            else if (k === 'learner role' || k === 'learner') phase.learnerRole = v;
            else if (k === 'helper role' || k === 'helper') phase.helperRole = v;
            else if (k === 'twist' || k === 'twists') phase.twist = v;
            i++;
            continue;
          }

          // Non-bullet, non-script lines inside phase (treat as step)
          phase.steps.push(inner);
          i++;
        }

        phases.push(phase);
        continue;
      }

      // Session-level key: value
      const kv = parseKeyValue(line);
      if (kv) {
        const key = kv.key.toLowerCase();
        const value = kv.value;

        if (key === 'title') title = value;
        else if (key === 'level') level = value;
        else if (key === 'partner') partner = value;
        else if (key.startsWith('goal')) goal = value;
        else if (key === 'context') context = value;
        else if (key === 'correction') correction = value;
        else if (key === 'learner role' || key === 'learner') learnerRole = value;
        else if (key === 'helper role' || key === 'helper') helperRole = value;
        else if (key === 'twists' || key === 'twist') twists = value.split(/\s*;\s*|\s*\|\s*|\s*,\s*/).filter(Boolean);

        i++;
        continue;
      }

      // Ignore other lines outside phases (like separators)
      i++;
    }

    const base = `${blockIdx + 1}-${title}`;
    const id = `${slugify(base) || `session-${blockIdx + 1}`}`;

    sessions.push({
      id,
      title,
      level,
      partner,
      goal,
      context,
      correction,
      learnerRole,
      helperRole,
      twists,
      phases,
      rawBlock: block.trim(),
    });
  });

  return sessions;
}
