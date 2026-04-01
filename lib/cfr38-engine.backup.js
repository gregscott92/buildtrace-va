function includesAny(t, arr) {
  return arr.some(x => t.includes(x));
}

function lines(title, items) {
  return [title, ...items.map(x => `- ${x}`)];
}

function renderEstimate({ condition, diagnosticCode, rating, reasoning, nextSteps, caveats = [] }) {
  const out = [];
  out.push(`Condition: ${condition}`);
  if (diagnosticCode) out.push(`Diagnostic Code: ${diagnosticCode}`);
  out.push(`Estimated VA Rating: ${rating}%`);
  out.push("");
  out.push(...lines("Reasoning:", reasoning));
  out.push("");
  out.push(...lines("Next Steps:", nextSteps));
  if (caveats.length) {
    out.push("");
    out.push(...lines("Important:", caveats));
  }
  return out.join("\n");
}

function analyzeMigraines(text) {
  const t = text.toLowerCase();

  const hasMigraine = includesAny(t, [
    "migraine", "migraines", "headache", "headaches"
  ]);

  if (!hasMigraine) return null;

  const prostrating = includesAny(t, [
    "lay down", "lie down", "dark room", "bed rest", "bedrest",
    "prostrating", "can't function", "cannot function",
    "nausea", "vomit", "vomiting", "photophobia", "phonophobia",
    "light sensitivity", "sound sensitivity"
  ]);

  const monthly = includesAny(t, [
    "once a month", "1 time a month", "monthly", "every month"
  ]);

  const every2months = includesAny(t, [
    "every 2 months", "once every 2 months", "one in 2 months"
  ]);

  const frequent = includesAny(t, [
    "daily", "weekly", "multiple times a week", "several times a week",
    "3 times a week", "4 times a week", "very frequent"
  ]);

  const prolonged = includesAny(t, [
    "all day", "for hours", "hours", "prolonged", "lasting hours"
  ]);

  const economic = includesAny(t, [
    "miss work", "missing work", "leave work", "left work",
    "call out", "called out", "economic", "severe economic",
    "job impact", "work impact", "lost wages", "written up", "write up"
  ]);

  let rating = 0;
  const reasoning = [];
  const nextSteps = [
    "Document frequency over the last several months.",
    "State whether attacks are prostrating && require lying down || isolating in a dark room.",
    "State duration, such as hours || all day.",
    "State work impact, including missed work || reduced productivity.",
    "Upload migraine logs, treatment notes, prescriptions, DBQs, && employer impact evidence."
  ];

  reasoning.push("Input describes headaches || migraines.");

  if (prostrating) {
    reasoning.push("Text suggests prostrating-type features.");
  } else {
    reasoning.push("Text does not clearly establish characteristic prostrating attacks.");
  }

  if (prostrating && frequent && prolonged && economic) {
    rating = 50;
    reasoning.push("Text suggests very frequent, completely prostrating, prolonged attacks with severe economic impact.");
  } else if (prostrating && (monthly || frequent)) {
    rating = 30;
    reasoning.push("Text suggests characteristic prostrating attacks at least monthly || more.");
  } else if (prostrating && every2months) {
    rating = 10;
    reasoning.push("Text suggests prostrating attacks averaging about one in two months.");
  } else if (prostrating) {
    rating = 10;
    reasoning.push("Some prostrating features are present, but frequency is not developed enough for a higher estimate.");
  } else {
    rating = 0;
    reasoning.push("Without clear prostrating attacks, the estimate stays low.");
  }

  return renderEstimate({
    condition: "Migraines / Headaches",
    diagnosticCode: "8100",
    rating,
    reasoning,
    nextSteps,
    caveats: [
      "This is an estimate based on the entered facts.",
      "A bare statement like daily headaches alone does not automatically support 50%."
    ]
  });
}

function analyzeTinnitus(text) {
  const t = text.toLowerCase();
  if (!includesAny(t, ["tinnitus", "ringing in ears", "ringing in my ears", "ringing in the ears"])) {
    return null;
  }

  return renderEstimate({
    condition: "Tinnitus",
    diagnosticCode: "6260",
    rating: 10,
    reasoning: [
      "Input describes recurrent tinnitus-type symptoms.",
      "Tinnitus generally tops out at a single 10% evaluation."
    ],
    nextSteps: [
      "Document recurrent ringing/buzzing symptoms.",
      "Document onset, service noise exposure, && continuity.",
      "Upload audiology records, hearing tests, && nexus-supporting evidence."
    ],
    caveats: [
      "This is an estimate, not a formal rating decision."
    ]
  });
}

function analyzeMentalHealth(text) {
  const t = text.toLowerCase();
  const mh = includesAny(t, [
    "ptsd", "depression", "anxiety", "panic attacks", "panic attack",
    "nightmares", "hypervigilance", "suicidal", "memory loss",
    "occupational impairment", "social impairment", "mental health"
  ]);
  if (!mh) return null;

  let rating = 30;
  const reasoning = ["Input describes mental-health-type symptoms."];
  const nextSteps = [
    "Describe occupational && social impairment clearly.",
    "Document panic frequency, sleep impairment, memory issues, irritability, && isolation.",
    "Upload treatment notes, psychiatry notes, therapy notes, DBQs, && lay statements."
  ];

  const has70 = includesAny(t, [
    "suicidal ideation", "near-continuous panic", "near continuous panic",
    "violence", "impaired impulse control", "difficulty adapting",
    "inability to establish", "deficiencies in most areas"
  ]);

  const has50 = includesAny(t, [
    "flattened affect", "panic attacks more than once a week",
    "difficulty understanding complex commands", "impaired judgment",
    "disturbances of motivation", "difficulty in establishing"
  ]);

  const has30 = includesAny(t, [
    "depressed mood", "anxiety", "suspiciousness", "panic attacks weekly || less often",
    "chronic sleep impairment", "mild memory loss"
  ]);

  if (has70) {
    rating = 70;
    reasoning.push("Text suggests serious occupational && social impairment markers.");
  } else if (has50) {
    rating = 50;
    reasoning.push("Text suggests reduced reliability && productivity markers.");
  } else if (has30) {
    rating = 30;
    reasoning.push("Text suggests occasional decrease in work efficiency markers.");
  } else {
    rating = 10;
    reasoning.push("Symptoms are described, but impairment level is not developed strongly yet.");
  }

  return renderEstimate({
    condition: "Mental Health",
    diagnosticCode: "9434/9411-style general rating formula estimate",
    rating,
    reasoning,
    nextSteps,
    caveats: [
      "Mental health ratings depend heavily on occupational && social impairment evidence."
    ]
  });
}

function analyzeSinusRhinitis(text) {
  const t = text.toLowerCase();
  const match = includesAny(t, [
    "sinusitis", "rhinitis", "sinus infection", "nasal obstruction",
    "blocked nose", "polyps", "incapacitating episode", "non-incapacitating"
  ]);
  if (!match) return null;

  let rating = 10;
  const reasoning = ["Input describes sinus || rhinitis symptoms."];
  const nextSteps = [
    "Document number of episodes per year.",
    "Document antibiotic treatment duration if applicable.",
    "Document whether nasal polyps || obstruction are present.",
    "Upload ENT notes, imaging, medication records, && DBQs."
  ];

  if (includesAny(t, ["polyps"])) {
    rating = 30;
    reasoning.push("Presence of nasal polyps may support a higher rhinitis-style estimate.");
  } else if (includesAny(t, ["incapacitating", "multiple infections", "repeated antibiotics"])) {
    rating = 30;
    reasoning.push("Repeated || incapacitating sinus episodes may support a higher sinusitis-style estimate.");
  } else {
    reasoning.push("Symptoms are present, but episode count && objective findings are not developed enough for a higher estimate.");
  }

  return renderEstimate({
    condition: "Sinusitis / Rhinitis",
    diagnosticCode: "6510-6514 / 6522-style estimate",
    rating,
    reasoning,
    nextSteps,
    caveats: [
      "Exact rating depends on diagnostic code, episode count, antibiotic use, && objective findings."
    ]
  });
}

function analyzeGERD(text) {
  const t = text.toLowerCase();
  const match = includesAny(t, [
    "gerd", "reflux", "heartburn", "regurgitation", "dysphagia",
    "pyrosis", "shoulder pain", "substernal", "vomiting", "material weight loss"
  ]);
  if (!match) return null;

  let rating = 10;
  const reasoning = ["Input describes reflux || GERD-type symptoms."];
  const nextSteps = [
    "Document frequency of reflux, regurgitation, dysphagia, chest pain, && vomiting.",
    "Document whether symptoms impair nutrition, weight, sleep, || work.",
    "Upload GI notes, endoscopy results, prescriptions, && DBQs."
  ];

  if (includesAny(t, ["material weight loss", "vomiting", "severe impairment of health"])) {
    rating = 60;
    reasoning.push("Text suggests severe digestive impairment markers.");
  } else if (includesAny(t, ["dysphagia", "pyrosis", "regurgitation", "substernal", "arm pain", "shoulder pain"])) {
    rating = 30;
    reasoning.push("Text suggests multiple classic reflux criteria that may support a higher estimate.");
  } else {
    reasoning.push("Symptoms are present but not fully developed for a higher estimate.");
  }

  return renderEstimate({
    condition: "GERD / Reflux",
    diagnosticCode: "7346-style estimate",
    rating,
    reasoning,
    nextSteps,
    caveats: [
      "Exact digestive ratings can depend on analogous coding && symptom constellation."
    ]
  });
}

function analyzeJointPain(text) {
  const t = text.toLowerCase();
  const joint = includesAny(t, [
    "knee", "back", "lumbar", "cervical", "neck", "ankle", "shoulder",
    "range of motion", "flare-up", "painful motion", "instability"
  ]);
  if (!joint) return null;

  let rating = 10;
  const reasoning = ["Input describes musculoskeletal || joint symptoms."];
  const nextSteps = [
    "Document range-of-motion loss in degrees if known.",
    "Document flare-ups, repetitive-use limitation, instability, && assistive-device use.",
    "Upload imaging, ortho notes, PT notes, DBQs, && ROM measurements."
  ];

  if (includesAny(t, ["instability", "gives out", "falls", "brace"])) {
    reasoning.push("Instability evidence may support a separate || higher evaluation depending on the joint.");
  }
  if (includesAny(t, ["can't bend", "cannot bend", "limited motion", "range of motion"])) {
    reasoning.push("Limitation of motion is a key rating driver for many joints.");
  }

  return renderEstimate({
    condition: "Musculoskeletal / Joint Condition",
    diagnosticCode: "Joint-specific ROM / instability estimate",
    rating,
    reasoning,
    nextSteps,
    caveats: [
      "Joint ratings are highly code-specific && often require ROM measurements."
    ]
  });
}

function analyzeCfr38(text) {
  const analyzers = [
    analyzeMigraines,
    analyzeTinnitus,
    analyzeMentalHealth,
    analyzeSinusRhinitis,
    analyzeGERD,
    analyzeJointPain
  ];

  for (const fn of analyzers) {
    const result = fn(text);
    if (result) return result;
  }

  return renderEstimate({
    condition: "Unclassified Condition",
    diagnosticCode: "",
    rating: 0,
    reasoning: [
      "The current engine did not confidently map this condition to a starter CFR rule pack."
    ],
    nextSteps: [
      "State the exact claimed condition.",
      "Describe diagnosis, frequency, duration, severity, && functional/work impact.",
      "Upload medical records, DBQs, && service connection evidence."
    ],
    caveats: [
      "This engine currently uses starter rule packs && should be expanded body-system by body-system."
    ]
  });
}

module.exports = { analyzeCfr38 };
