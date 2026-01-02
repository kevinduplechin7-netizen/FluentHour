import type { PerfectHourPhase, PerfectHourSession } from './parsePerfectHour';

export type CopyForAIOptions = {
  targetLanguageName: string;
  session: PerfectHourSession;
};

function safe(v?: string) {
  return (v ?? '').trim();
}

function bulletLines(lines: string[], indent = ''): string {
  const cleaned = (lines ?? []).map((l) => (l ?? '').trim()).filter(Boolean);
  if (!cleaned.length) return `${indent}• (none)`;
  return cleaned.map((l) => `${indent}• ${l}`).join('\n');
}

function renderPhase(phase: PerfectHourPhase): string {
  const header = `PHASE ${phase.index}: ${phase.name} (${phase.minutes}m)`;
  const parts: string[] = [header];

  if (safe(phase.purpose)) parts.push(`Purpose: ${safe(phase.purpose)}`);
  if (safe(phase.learnerRole)) parts.push(`Learner role: ${safe(phase.learnerRole)}`);
  if (safe(phase.helperRole)) parts.push(`Language helper role: ${safe(phase.helperRole)}`);
  if (safe(phase.twist)) parts.push(`Twist: ${safe(phase.twist)}`);

  parts.push('Steps:');
  parts.push(bulletLines(phase.steps, ''));

  if (safe(phase.helperScript)) {
    parts.push('AI helper script:');
    parts.push(safe(phase.helperScript));
  }

  return parts.join('\n');
}

export function buildCopyForAIText(opts: CopyForAIOptions): string {
  const s = opts.session;
  const lang = safe(opts.targetLanguageName) || 'TARGET LANGUAGE';

  const out: string[] = [];

  // --- Prompt section ---
  out.push('LANGUAGE HELPER INSTRUCTIONS');
  out.push('');
  out.push(`You are my *language helper* for ${lang}.`);
  out.push('Run the session below phase-by-phase. Keep it friendly, non-judgmental, and efficient.');
  out.push('');
  out.push('Output rules (non-negotiable):');
  out.push('1) Speak in the target language, but ALWAYS include an English translation on the next line.');
  out.push('   Exact format for every helper line (exactly two lines):');
  out.push('   <Target language sentence>');
  out.push('   ↳ <English translation>');
  out.push('2) No speaker labels (no “Helper:” / “Learner:” / names).');
  out.push('3) Keep translations short and faithful (not overly paraphrased).');
  out.push('4) When it is my turn to speak, give me TWO to FOUR sample responses in the SAME two-line format.');
  out.push('   Then ask me to choose one OR say my own version, and WAIT for my reply.');
  out.push('5) If I answer in English or with mistakes, you still respond with target-language lines + English translations.');
  out.push('6) Corrections: use a “recast” style. Keep it short.');
  out.push('   - Give the corrected sentence in the same two-line format.');
  out.push('   - Then give ONE tiny tip (in English) only if needed.');
  out.push('');
  out.push('How to run phases:');
  out.push('• Start each phase by restating the mini-situation (one sentence) and what we are doing (one sentence).');
  out.push('• Use the session “Correction focus” when you correct me.');
  out.push('• Keep the pace: short turns, lots of repetition, and frequent opportunities for me to speak.');
  out.push('');

  // --- Session content section ---
  out.push('SESSION CONTENT (use this as your script)');
  out.push('');
  out.push(`Title: ${s.title}`);
  if (safe(s.level)) out.push(`Level: ${safe(s.level)}`);
  if (safe(s.partner)) out.push(`Partner: ${safe(s.partner)}`);
  if (safe(s.goal)) out.push(`Goal: ${safe(s.goal)}`);
  if (safe(s.context)) out.push(`Context: ${safe(s.context)}`);
  if (safe(s.correction)) out.push(`Correction focus: ${safe(s.correction)}`);
  if (safe(s.learnerRole)) out.push(`Learner role: ${safe(s.learnerRole)}`);
  if (safe(s.helperRole)) out.push(`Language helper role: ${safe(s.helperRole)}`);
  if (s.twists && s.twists.length) out.push(`Twists: ${s.twists.join(', ')}`);

  out.push('');
  out.push('Phases:');
  out.push('');

  for (const ph of s.phases) {
    out.push(renderPhase(ph));
    out.push('');
  }

  out.push('START NOW');
  out.push('');
  out.push('Begin Phase 1. Remember: every helper line must be target language + English translation on the next line.');

  return out.join('\n');
}
