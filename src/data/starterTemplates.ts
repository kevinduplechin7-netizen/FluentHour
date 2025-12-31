export type PartnerMode = "human" | "ai";

export type PhaseKey = "review" | "fluency" | "input" | "simulation" | "record";

export type Template = {
  id: string;
  title: string;
  locked: boolean;

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
      // template trigger is four minutes, but rule says five minutes or later
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
];
