export type PartnerMode = "human" | "ai";

export type PhaseKey = "review" | "fluency" | "input" | "simulation" | "record";

export type Template = {
  id: string;
  title: string;
  locked: boolean;
  level: "A1" | "A2" | "B1" | "B2" | "C1" | "C2";

  meta?: {
    createdAtIso?: string;
    source?: "starter" | "ai" | "manual";
    recipe?: Record<string, any>;
  };

  outcome: string;
  restrictions: string[];
  procedure: string[];
  learnerCard: string;
  helperCard: string;
  hiddenInformation: string;

  mandatoryObjections: string[];

  twist: {
    wording: string; // must display exactly
    triggerAfterSeconds: number; // template-defined trigger
  };

  sessionScript: {
    fluency: string;
    input: string;
    simulation: string;
    record: string;
  };
};

export const PHASES_FIXED: Array<{ key: PhaseKey; label: string; defaultSeconds: number }> = [
  // review is optional; baseline auto-skips because no history yet
  { key: "review", label: "Review (auto-skip if empty)", defaultSeconds: 0 },
  { key: "fluency", label: "Fluency", defaultSeconds: 10 * 60 },
  { key: "input", label: "Input (Series Method)", defaultSeconds: 15 * 60 },
  { key: "simulation", label: "Simulation (Main Task)", defaultSeconds: 20 * 60 },
  { key: "record", label: "Record for Correction", defaultSeconds: 10 * 60 },
];

export const STARTER_TEMPLATES: Template[] = [
  {
    id: "starter-transaction-repair",
    title: "Transaction repair (starter)",
    locked: true,
    level: "B1",
    meta: { source: "starter" },

    outcome: "You leave with the correct item or a clear resolution (refund, replacement, or delivery plan).",
    restrictions: [
      "You are always yourself. No acting as a different identity.",
      "Fluency before accuracy. No stopping to fix grammar mid-stream.",
      "No corrections until the Record for Correction phase.",
      "Negotiate using real constraints (time, budget, policy, emotions).",
    ],
    procedure: [
      "State the problem in one sentence, calmly.",
      "Ask one clear question.",
      "Offer one reasonable option.",
      "If refused, restate the outcome and propose a second option.",
      "If conflict rises, set a boundary and return to the outcome.",
    ],
    learnerCard: [
      "You bought something and there is a real problem.",
      "Your goal is a practical resolution today.",
      "You must stay calm and persistent.",
      "Use short sentences and keep the conversation moving.",
    ].join("\n"),
    helperCard: [
      "You play the staff member (polite, but constrained by policy).",
      "You must raise at least two objections from the mandatory list.",
      "You must not correct language until the end.",
      "Your job is to force real negotiation and a real outcome.",
    ].join("\n"),
    hiddenInformation: [
      "Policy allows a replacement only if the learner provides one piece of evidence (receipt, order number, or photo).",
      "You are understaffed and short on time, so you prefer a quick solution.",
      "A manager approval is required for refunds above a small amount.",
    ].join("\n"),
    mandatoryObjections: [
      "I can’t do a refund without a receipt.",
      "That’s outside our policy.",
      "The manager is not available right now.",
      "The soonest delivery is next week.",
    ],
    twist: {
      wording:
        "TWIST: The staff member says: “I can help, but only if you can show proof of purchase right now. Otherwise, the best I can offer is store credit.”",
      // template trigger is 4 minutes, but app rule is 5 minutes or later
      triggerAfterSeconds: 4 * 60,
    },
    sessionScript: {
      fluency:
        "Speak freely about a recent purchase or service experience. Keep going. If you pause, paraphrase and continue. No corrections.",
      input:
        "Helper tells a short, simple story (series method) about a store problem and resolution. Learner listens, then retells the story in their own words. No corrections.",
      simulation:
        "Run the full negotiation. Use the procedure. Helper uses mandatory objections. After the twist unlocks, trigger it once at a natural moment.",
      record:
        "Now do selective recasts and high-value corrections only. Focus on phrases that unlock outcomes: requests, clarifying questions, objections, boundaries, and polite insistence.",
    },
  },

  {
    id: "starter-negotiated-request",
    title: "Negotiated request with constraints (starter)",
    locked: true,
    level: "B1",
    meta: { source: "starter" },

    outcome: "You obtain a clear agreement: yes with details, a realistic alternative, or a firm no with reasons and next steps.",
    restrictions: [
      "You are always yourself (no invented identity).",
      "Fluency before accuracy. Keep moving forward.",
      "No corrections until the Record for Correction phase.",
      "You must negotiate around at least two real constraints (time, money, policy, relationship, safety).",
    ],
    procedure: [
      "State the request in one sentence.",
      "Give a reason (one sentence).",
      "Ask for one specific option (time/date/amount).",
      "If refused, ask what IS possible.",
      "Confirm the agreement in one final summary.",
    ],
    learnerCard: [
      "You need a favor or adjustment that affects the other person.",
      "Your constraints: you have limited time and a limited budget.",
      "You must ask clearly and accept negotiation without getting defensive.",
      "Your goal is an explicit agreement (not vague).",
    ].join("\n"),
    helperCard: [
      "You play the other person (helpful but constrained).",
      "You must raise at least two objections from the mandatory list.",
      "You must not correct language until the end.",
      "Push the learner to specify details and confirm an agreement.",
    ].join("\n"),
    hiddenInformation: [
      "You are willing to say yes only if the learner accepts one tradeoff.",
      "You dislike last-minute requests; you need clarity and a plan.",
      "You can offer an alternative that is not the learner’s first choice.",
    ].join("\n"),
    mandatoryObjections: [
      "I can’t do that at that time.",
      "That’s more than I can offer.",
      "I need more details before I can agree.",
      "I’m not comfortable committing unless we set conditions.",
    ],
    twist: {
      wording:
        "TWIST: The helper says: “I can say yes, but only if you accept one condition: you must choose either a lower cost option OR a later time. You can’t have both.”",
      triggerAfterSeconds: 6 * 60,
    },
    sessionScript: {
      fluency:
        "Talk about a time you needed something from someone (a favor, schedule change, refund, exception). Keep speaking without correcting yourself.",
      input:
        "Helper tells a short series-method story about a request that required negotiation (ask → objection → alternative → agreement). Learner retells the story.",
      simulation:
        "Run the negotiation. Require specifics (time/date/amount). Use at least two objections. Trigger the twist once when available.",
      record:
        "Selective recasts and high-value corrections: polite requests, conditions, clarifying questions, confirming agreements, and summarizing decisions.",
    },
  },

  {
    id: "starter-boundary-disagreement",
    title: "Disagreement / boundary setting (starter)",
    locked: true,
    level: "B2",
    meta: { source: "starter" },

    outcome: "You clearly state your boundary, acknowledge the other person, and reach a respectful next step (agreement, compromise, or pause).",
    restrictions: [
      "You are always yourself.",
      "Fluency before accuracy; keep the conversation moving.",
      "No corrections until Record for Correction.",
      "You must use at least one boundary statement and one de-escalation move.",
    ],
    procedure: [
      "Acknowledge (one sentence).",
      "State boundary (one sentence).",
      "Offer an alternative (one sentence).",
      "If pushed, repeat boundary calmly (no new explanations).",
      "Close with next step (what happens now).",
    ],
    learnerCard: [
      "Someone is pressuring you to do something you don’t want to do.",
      "You want to stay respectful and calm.",
      "Your goal is clarity, not winning.",
      "Use short sentences. Repeat your boundary if needed.",
    ].join("\n"),
    helperCard: [
      "You play the other person (emotionally invested, somewhat pushy).",
      "You must challenge the learner at least twice (mandatory objections).",
      "You must not correct language until the end.",
      "Push for a real outcome: compromise, pause, or firm no.",
    ].join("\n"),
    hiddenInformation: [
      "You feel ignored and interpret the boundary as rejection.",
      "If the learner offers a respectful alternative, you can accept it.",
      "If the learner becomes vague, you will push harder for commitment.",
    ].join("\n"),
    mandatoryObjections: [
      "Come on, it’s not a big deal.",
      "You’re being unfair.",
      "If you cared, you would do it.",
      "So you’re saying no to me?",
    ],
    twist: {
      wording:
        "TWIST: The helper says: “If you won’t do this, then I need an answer right now about whether you’ll do ANYTHING to help.”",
      triggerAfterSeconds: 5 * 60,
    },
    sessionScript: {
      fluency:
        "Speak about a situation where you had to say no or set a limit. Keep going; don’t self-correct.",
      input:
        "Helper tells a short story about a disagreement that ended well because of a clear boundary and a concrete alternative. Learner retells it.",
      simulation:
        "Run the disagreement. Learner must use a boundary statement and a calm repeat. Trigger the twist once when available.",
      record:
        "Selective recasts: boundary phrases, empathy acknowledgements, calm repeats, and closing language (next step / pause / compromise).",
    },
  },

  {
    id: "starter-professional-explanation",
    title: "Professional explanation (starter)",
    locked: true,
    level: "B1",
    meta: { source: "starter" },

    outcome: "You explain a process or decision clearly, answer questions, and confirm understanding and next steps.",
    restrictions: [
      "You are always yourself.",
      "Fluency before accuracy; keep it simple and clear.",
      "No corrections until Record for Correction.",
      "You must confirm understanding at least once.",
    ],
    procedure: [
      "One-sentence summary first.",
      "Explain in three steps (short).",
      "Invite one question.",
      "Clarify with an example.",
      "Confirm next steps + timeline.",
    ],
    learnerCard: [
      "You must explain something professionally (a plan, an update, a decision, a process).",
      "You want to sound calm, clear, and confident.",
      "Keep it structured: summary → steps → questions → next steps.",
    ].join("\n"),
    helperCard: [
      "You play a colleague/client who needs clarity and is slightly skeptical.",
      "Ask at least two questions (mandatory objections).",
      "Do not correct language until the end.",
      "Force the learner to clarify and confirm next steps.",
    ].join("\n"),
    hiddenInformation: [
      "You are worried about delays and risk, and you want a clear timeline.",
      "If the learner confirms next steps clearly, you relax.",
      "If the learner is vague, you ask for exact details.",
    ].join("\n"),
    mandatoryObjections: [
      "Can you explain that more simply?",
      "What’s the timeline, exactly?",
      "What happens if this goes wrong?",
      "I’m not sure I understand—what do you want me to do?",
    ],
    twist: {
      wording:
        "TWIST: The helper says: “We have a new constraint: the timeline just shortened. You must restate the plan with the new deadline and the biggest risk.”",
      triggerAfterSeconds: 7 * 60,
    },
    sessionScript: {
      fluency:
        "Talk about a process you know well (how you plan a trip, how you organize work, how you learn languages). Keep speaking without correcting yourself.",
      input:
        "Helper tells a short, simple explanation in steps (summary → step one → step two → step three). Learner retells it using the same structure.",
      simulation:
        "Learner explains a plan or decision. Helper asks questions and pushes for clarity. Trigger the twist once when available.",
      record:
        "Selective recasts: structuring language (first/next/final), clarifying questions, confirming understanding, and stating next steps and timelines.",
    },
  },
];
