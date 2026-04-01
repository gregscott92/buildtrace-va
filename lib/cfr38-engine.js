function fallbackResult(raw) {
  return `Condition: Unclassified Condition
Estimated VA Rating: 0%

Reasoning:
- The current engine did not confidently map this condition to a starter CFR rule pack.
- The text may be too vague, may describe multiple body systems, or may not include enough rating details.

Next Steps:
- State the exact claimed condition.
- Describe diagnosis, frequency, duration, severity, and functional or work impact.
- Upload medical records, DBQs, nexus letters, and service connection evidence.
- Clarify flare-ups, limitations, sleep effects, and occupational impact where applicable.

Important:
- This tool is best used as a claim-prep assistant, not a final rating decision maker.
- It is intended to help a user prepare before filing, not replace a VSO, attorney, DBQ, C&P exam, or VA decision.
- Final ratings depend on the full medical and service record, exam findings, and adjudicator review.`;
}

function hasAny(t, terms) {
  return terms.some((term) => t.includes(term));
}

function inferConfidence({ rating, reasoning, evidenceNeeded }) {
  const reasonCount = Array.isArray(reasoning) ? reasoning.length : 0;
  const missingCount = Array.isArray(evidenceNeeded) ? evidenceNeeded.length : 0;

  if (rating >= 50 && reasonCount >= 3 && missingCount <= 3) {
    return "High";
  }

  if (reasonCount >= 2 && missingCount <= 4) {
    return "Medium";
  }

  return "Low";
}

function renderBlock({
  condition,
  diagnosticCode,
  rating,
  confidence = null,
  reasoning,
  evidenceNeeded = [],
  nextSteps,
  important
}) {
  const finalConfidence = confidence || inferConfidence({
    rating,
    reasoning,
    evidenceNeeded
  });

  return [
    `Condition: ${condition}`,
    diagnosticCode ? `Diagnostic Code: ${diagnosticCode}` : null,
    `Estimated VA Rating: ${rating}%`,
    `Confidence: ${finalConfidence}`,
    ``,
    `Reasoning:`,
    ...reasoning.map((x) => `- ${x}`),
    ``,
    `Evidence Still Needed:`,
    ...(evidenceNeeded.length
      ? evidenceNeeded.map((x) => `- ${x}`)
      : [`- Additional supporting evidence may still be needed.`]),
    ``,
    `Next Steps:`,
    ...nextSteps.map((x) => `- ${x}`),
    ``,
    `Important:`,
    ...important.map((x) => `- ${x}`)
  ].filter(Boolean).join("\n");
}

function buildMissingEvidence(condition, t) {
  const base = [];

  if (!hasAny(t, ["diagnosis", "diagnosed", "dx", "doctor", "provider"])) {
    base.push("Current diagnosis");
  }

  if (!hasAny(t, ["military", "service", "deployment", "in service", "during service", "noise exposure", "started during"])) {
    base.push("Service connection or in-service event");
  }

  if (!hasAny(t, ["dbq", "treatment", "treated", "therapy", "medication", "prescription", "records"])) {
    base.push("Treatment records or DBQ");
  }

  if (!hasAny(t, ["work", "misses work", "job", "productivity", "daily activities", "functional impact"])) {
    base.push("Work or functional impact details");
  }

  if (condition.includes("Migraines")) {
    if (!hasAny(t, ["per month", "weekly", "times per month", "frequency"])) {
      base.push("Headache frequency details");
    }
    if (!hasAny(t, ["lie down", "dark room", "prostrating"])) {
      base.push("Evidence that attacks are prostrating");
    }
  }

  if (condition.includes("Mental Health") || condition.includes("PTSD")) {
    if (!hasAny(t, ["panic", "depression", "anxiety", "nightmares", "relationships", "hygiene"])) {
      base.push("Specific mental health symptom details");
    }
    if (!hasAny(t, ["work", "family", "social", "occupational"])) {
      base.push("Occupational and social impairment details");
    }
  }

  if (condition.includes("Sleep Apnea")) {
    if (!hasAny(t, ["sleep study", "cpap", "bipap"])) {
      base.push("Sleep-study results or CPAP evidence");
    }
  }

  if (condition.includes("Hearing Loss")) {
    if (!hasAny(t, ["maryland cnc", "puretone", "audiology", "speech recognition"])) {
      base.push("Formal audiology results");
    }
  }

  if (condition.includes("Rhinitis") || condition.includes("Sinusitis")) {
    if (!hasAny(t, ["polyps", "obstruction", "episodes", "antibiotics"])) {
      base.push("Objective ENT findings or episode counts");
    }
  }

  if (condition.includes("Lumbar Back") || condition.includes("Knee")) {
    if (!hasAny(t, ["range of motion", "rom", "flexion", "extension"])) {
      base.push("Range-of-motion findings");
    }
  }

  if (condition.includes("Radiculopathy")) {
    if (!hasAny(t, ["emg", "nerve", "weakness", "extremity"])) {
      base.push("Nerve testing or extremity severity details");
    }
  }

  return [...new Set(base)];
}

function combineVaRatings(ratings) {
  const cleaned = (Array.isArray(ratings) ? ratings : [])
    .map((x) => Number(x))
    .filter((x) => Number.isFinite(x) && x >= 0)
    .sort((a, b) => b - a);

  let combined = 0;

  for (const r of cleaned) {
    combined = combined + (100 - combined) * (r / 100);
  }

  const roundedWhole = Math.round(combined);
  const roundedToTen = Math.round(roundedWhole / 10) * 10;

  return {
    ratings: cleaned,
    rawCombined: combined,
    roundedWhole,
    roundedToTen
  };
}

// ============================
// MIGRAINES / HEADACHES
// ============================
function analyzeMigraines(t) {
  const monthly34 = hasAny(t, [
    "3 to 4 times per month",
    "3-4 times per month",
    "3 or 4 times per month",
    "three to four times per month",
    "3 times per month",
    "4 times per month"
  ]);

  const monthly =
    monthly34 ||
    hasAny(t, [
      "monthly",
      "once a month",
      "1 time per month",
      "2 times per month",
      "per month"
    ]);

  const prostrating = hasAny(t, [
    "lie down",
    "lay down",
    "dark room",
    "prostrating",
    "light sensitivity",
    "photophobia",
    "nausea",
    "vomiting"
  ]);

  const severeImpact = hasAny(t, [
    "misses work",
    "missed work",
    "unable to work",
    "call out",
    "call off",
    "leave work early",
    "reduced productivity",
    "economic impact"
  ]);

  if (prostrating && monthly34 && severeImpact) {
    return renderBlock({
      condition: "Migraines / Headaches",
      diagnosticCode: "8100",
      rating: 50,
      confidence: "High",
      reasoning: [
        "Headaches or migraines are described.",
        "The statement supports characteristic prostrating attacks.",
        "Frequency appears around 3 to 4 times per month.",
        "The statement also describes work or economic impact."
      ],
      evidenceNeeded: buildMissingEvidence("Migraines / Headaches", t),
      nextSteps: [
        "Keep a migraine log with date, duration, and whether you had to lie down.",
        "Document missed work, reduced productivity, or leaving early.",
        "Upload treatment records, prescriptions, DBQs, and supporting statements.",
        "Clarify how long attacks last and whether they are completely prostrating."
      ],
      important: [
        "This is an estimate based on the entered facts.",
        "Final ratings depend on the full record and adjudicator review."
      ]
    });
  }

  if (prostrating && monthly) {
    return renderBlock({
      condition: "Migraines / Headaches",
      diagnosticCode: "8100",
      rating: 30,
      confidence: "Medium",
      reasoning: [
        "Headaches or migraines are described.",
        "The statement supports characteristic prostrating attacks.",
        "Frequency appears at least monthly."
      ],
      evidenceNeeded: buildMissingEvidence("Migraines / Headaches", t),
      evidenceNeeded: buildMissingEvidence("Migraines / Headaches", t),
      nextSteps: [
        "Keep a migraine log with date, duration, and whether you had to lie down.",
        "Upload treatment notes, prescriptions, DBQs, and statements.",
        "Clarify work impact and attack duration."
      ],
      important: [
        "This is an estimate based on the entered facts.",
        "Final ratings depend on the full record and adjudicator review."
      ]
    });
  }

  return renderBlock({
    condition: "Migraines / Headaches",
    diagnosticCode: "8100",
    rating: 10,
      confidence: "Low",
    reasoning: [
      "Headaches or migraines are described.",
      "Some prostrating-type features may be present.",
      "The statement does not clearly establish the higher-frequency criteria."
    ],
    nextSteps: [
      "Document frequency over several months.",
      "State whether attacks require lying down or isolating in a dark room.",
      "State duration and work impact.",
      "Upload treatment records, prescriptions, DBQs, and supporting statements."
    ],
    important: [
      "This is an estimate based on the entered facts.",
      "Final ratings depend on the full record and adjudicator review."
    ]
  });
}

// ============================
// MENTAL HEALTH / PTSD
// Tightened: 100% only for clear total impairment signals
// ============================
function analyzeMentalHealth(t) {
  const totalImpairmentSignals = [
    "gross impairment in thought",
    "gross impairment in thought processes",
    "gross impairment in communication",
    "persistent delusions",
    "persistent hallucinations",
    "persistent danger of hurting self",
    "persistent danger of hurting others",
    "danger to self",
    "danger to others",
    "disorientation to time",
    "disorientation to place",
    "memory loss for names of close relatives",
    "memory loss for own occupation",
    "memory loss for own name"
  ];

  const seventySignals = [
    "suicidal ideation",
    "obsessional rituals",
    "near-continuous panic",
    "near continuous panic",
    "near-continuous depression",
    "near continuous depression",
    "impaired impulse control",
    "periods of violence",
    "spatial disorientation",
    "neglect of personal appearance",
    "neglect of personal hygiene",
    "difficulty adapting to stressful circumstances",
    "difficulty in adapting to stressful circumstances",
    "inability to establish and maintain effective relationships",
    "inability to maintain effective relationships"
  ];

  const fiftySignals = [
    "panic attacks more than once a week",
    "flattened affect",
    "circumstantial",
    "circumlocutory",
    "stereotyped speech",
    "difficulty in understanding complex commands",
    "impaired judgment",
    "impaired abstract thinking",
    "disturbances of motivation and mood",
    "difficulty in establishing and maintaining effective work and social relationships",
    "difficulty establishing and maintaining effective work and social relationships",
    "mild memory loss"
  ];

  const thirtySignals = [
    "depressed mood",
    "anxiety",
    "suspiciousness",
    "panic attacks weekly or less often",
    "chronic sleep impairment",
    "sleep impairment",
    "nightmares",
    "mild memory loss"
  ];

  const totalCount = totalImpairmentSignals.filter((x) => t.includes(x)).length;
  const seventyCount = seventySignals.filter((x) => t.includes(x)).length;
  const fiftyCount = fiftySignals.filter((x) => t.includes(x)).length;
  const thirtyCount = thirtySignals.filter((x) => t.includes(x)).length;

  const hasWorkAndSocialFailure = hasAny(t, [
    "total occupational and social impairment",
    "cannot work and cannot maintain relationships",
    "unable to work and isolated",
    "unable to function independently"
  ]);

  if ((totalCount >= 2 && hasWorkAndSocialFailure) || hasAny(t, ["total occupational and social impairment"])) {
    return renderBlock({
      condition: "PTSD / Mental Health",
      diagnosticCode: "9411 / General Rating Formula for Mental Disorders",
      rating: 100,
      confidence: "Medium",
      reasoning: [
        "The statement supports total occupational and social impairment.",
        "Multiple hallmark 100 percent indicators are present in the text."
      ],
      evidenceNeeded: buildMissingEvidence("PTSD / Mental Health", t),
      nextSteps: [
        "Upload mental health treatment records, hospitalization records, DBQs, and lay statements.",
        "Document inability to function independently, severe cognitive or psychotic symptoms, and total work/social impairment.",
        "Clarify safety issues, supervision needs, and severity over time."
      ],
      important: [
        "A 100 percent mental-health estimate should be reserved for clear total impairment patterns.",
        "Final ratings depend on the full record and adjudicator review."
      ]
    });
  }

  if (seventyCount >= 2 || (seventyCount >= 1 && fiftyCount >= 2)) {
    return renderBlock({
      condition: "PTSD / Mental Health",
      diagnosticCode: "9411 / General Rating Formula for Mental Disorders",
      rating: 70,
      confidence: "Medium",
      reasoning: [
        "The statement suggests deficiencies in most areas such as work, family relations, judgment, thinking, or mood.",
        "The text contains multiple high-severity mental health indicators.",
        "The record does not clearly establish total occupational and social impairment."
      ],
      evidenceNeeded: buildMissingEvidence("PTSD / Mental Health", t),
      nextSteps: [
        "Upload therapy notes, psychiatric records, DBQs, medication history, and lay statements.",
        "Document work problems, family strain, panic, depression, hygiene issues, and adaptation problems.",
        "Clarify frequency, severity, and duration of symptoms."
      ],
      important: [
        "This tier is often more appropriate than 100 percent when severe symptoms are present without clear total impairment.",
        "Final ratings depend on the full record and adjudicator review."
      ]
    });
  }

  if (fiftyCount >= 2 || (fiftyCount >= 1 && thirtyCount >= 2)) {
    return renderBlock({
      condition: "PTSD / Mental Health",
      diagnosticCode: "9411 / General Rating Formula for Mental Disorders",
      rating: 50,
      confidence: "High",
      reasoning: [
        "The statement suggests reduced reliability and productivity.",
        "The text contains moderate mental health symptoms affecting work or relationships."
      ],
      evidenceNeeded: buildMissingEvidence("PTSD / Mental Health", t),
      nextSteps: [
        "Upload therapy notes, psychiatric records, DBQs, medication history, and lay statements.",
        "Document panic frequency, concentration issues, relationship difficulty, and work impact."
      ],
      important: [
        "Mental-health ratings turn on occupational and social impairment, not symptom count alone.",
        "Final ratings depend on the full record and adjudicator review."
      ]
    });
  }

  if (thirtyCount >= 1) {
    return renderBlock({
      condition: "PTSD / Mental Health",
      diagnosticCode: "9411 / General Rating Formula for Mental Disorders",
      rating: 30,
      confidence: "Medium",
      reasoning: [
        "The statement suggests occasional decrease in work efficiency with intermittent periods of inability to perform tasks.",
        "The text describes symptoms such as anxiety, sleep impairment, nightmares, or depressed mood."
      ],
      evidenceNeeded: buildMissingEvidence("PTSD / Mental Health", t),
      nextSteps: [
        "Upload treatment records, prescriptions, DBQs, and lay statements.",
        "Document sleep problems, panic, irritability, and work or family impact."
      ],
      important: [
        "Mental-health ratings turn on occupational and social impairment, not symptom count alone.",
        "Final ratings depend on the full record and adjudicator review."
      ]
    });
  }

  return renderBlock({
    condition: "PTSD / Mental Health",
    diagnosticCode: "9411 / General Rating Formula for Mental Disorders",
    rating: 10,
      confidence: "Low",
    reasoning: [
      "A mental health condition is suggested, but the text describes only mild or limited functional impact.",
      "The statement does not clearly establish higher-level occupational and social impairment criteria."
    ],
    nextSteps: [
      "Upload treatment records, diagnosis, DBQs, and lay statements.",
      "Clarify work impact, social impairment, panic frequency, sleep impairment, and medication history."
    ],
    important: [
      "Mental-health ratings turn on occupational and social impairment, not symptom count alone.",
      "Final ratings depend on the full record and adjudicator review."
    ]
  });
}

function analyzeTinnitus(t) {
  return renderBlock({
    condition: "Tinnitus",
    diagnosticCode: "6260",
    rating: 10,
      confidence: "Low",
    reasoning: [
      "Tinnitus is described in the statement.",
      "Recurrent tinnitus generally carries a single 10 percent schedular evaluation."
    ],
    nextSteps: [
      "Document onset, noise exposure, and whether ringing is constant or recurrent.",
      "Upload audiology records, hearing tests, and statements about in-service noise exposure.",
      "Clarify service connection theory, such as weapons, aircraft, generators, or machinery."
    ],
    important: [
      "Tinnitus should not be over-scored beyond the standard schedular level in a basic engine.",
      "Final ratings and service connection depend on the full record and adjudicator review."
    ]
  });
}

function analyzeLumbarBack(t) {
  const severe = hasAny(t, [
    "unable to bend",
    "cannot bend",
    "severe flare",
    "severe pain",
    "radiculopathy",
    "radiates down leg",
    "shooting pain",
    "numbness",
    "tingling",
    "misses work",
    "limited motion"
  ]);

  const moderate = hasAny(t, [
    "daily pain",
    "pain with bending",
    "pain with standing",
    "pain with sitting",
    "stiffness",
    "flare-ups",
    "limited bending",
    "muscle spasm"
  ]);

  if (severe) {
    return renderBlock({
      condition: "Lumbar Back Condition",
      diagnosticCode: "Thoracolumbar Spine / Rating Formula Starter Estimate",
      rating: 40,
      confidence: "Medium",
      reasoning: [
        "The statement describes a lumbar back condition with significant functional loss, flare-ups, or neurologic-type symptoms.",
        "The text suggests more severe limitation or complications that can support a higher evaluation."
      ],
      evidenceNeeded: buildMissingEvidence("Lumbar Back Condition", t),
      nextSteps: [
        "Upload imaging, treatment records, DBQs, and range-of-motion findings.",
        "Document flare-ups, inability to bend, standing tolerance, sitting tolerance, and work impact.",
        "Clarify whether pain radiates, causes numbness, or affects walking or lifting."
      ],
      important: [
        "Back ratings should stay conservative without measured range-of-motion findings.",
        "Final ratings depend on the full record, exam findings, and adjudicator review."
      ]
    });
  }

  if (moderate) {
    return renderBlock({
      condition: "Lumbar Back Condition",
      diagnosticCode: "Thoracolumbar Spine / Rating Formula Starter Estimate",
      rating: 20,
      confidence: "Medium",
      reasoning: [
        "The statement describes a lumbar back condition with ongoing pain and functional limitation.",
        "The text suggests moderate impairment or flare-up activity."
      ],
      nextSteps: [
        "Upload treatment records, imaging, DBQs, and range-of-motion findings.",
        "Document bending limits, lifting problems, standing tolerance, and flare-ups.",
        "Clarify whether symptoms radiate into the legs."
      ],
      important: [
        "Back ratings should stay conservative without measured range-of-motion findings.",
        "Final ratings depend on the full record, exam findings, and adjudicator review."
      ]
    });
  }

  return renderBlock({
    condition: "Lumbar Back Condition",
    diagnosticCode: "Thoracolumbar Spine / Rating Formula Starter Estimate",
    rating: 10,
      confidence: "Low",
    reasoning: [
      "A lumbar back condition is described, but the text currently supports only mild painful motion or limited functional detail.",
      "The statement does not clearly establish the higher-level criteria."
    ],
    nextSteps: [
      "Upload treatment records, imaging, DBQs, and range-of-motion findings.",
      "Clarify flare-ups, motion loss, and work or daily activity impact."
    ],
    important: [
      "Back ratings should stay conservative without measured range-of-motion findings.",
      "Final ratings depend on the full record, exam findings, and adjudicator review."
    ]
  });
}

function analyzeRadiculopathy(t) {
  const severe = hasAny(t, [
    "constant severe pain",
    "marked muscle atrophy",
    "foot drop",
    "weakness",
    "cannot walk",
    "severe numbness",
    "severe tingling"
  ]);

  const moderate = hasAny(t, [
    "radiates down leg",
    "shooting pain",
    "numbness",
    "tingling",
    "burning pain",
    "sciatica"
  ]);

  if (severe) {
    return renderBlock({
      condition: "Radiculopathy / Peripheral Nerve Involvement",
      diagnosticCode: "4.124a starter estimate",
      rating: 40,
      confidence: "Medium",
      reasoning: [
        "The statement suggests significant nerve involvement with severe sensory or motor features.",
        "The text supports a higher starter estimate."
      ],
      evidenceNeeded: buildMissingEvidence("Radiculopathy / Peripheral Nerve Involvement", t),
      nextSteps: [
        "Upload neurology notes, spine records, DBQs, EMG or nerve testing, and treatment records.",
        "Clarify which extremity is affected, severity, weakness, numbness, and gait impact."
      ],
      important: [
        "Peripheral nerve ratings depend on the specific nerve and degree of incomplete or complete paralysis.",
        "Final ratings depend on the full record, exam findings, and adjudicator review."
      ]
    });
  }

  if (moderate) {
    return renderBlock({
      condition: "Radiculopathy / Peripheral Nerve Involvement",
      diagnosticCode: "4.124a starter estimate",
      rating: 20,
      confidence: "Medium",
      reasoning: [
        "The statement suggests radiating pain, numbness, tingling, or sciatica-type symptoms.",
        "The text supports a moderate starter estimate pending objective findings."
      ],
      evidenceNeeded: buildMissingEvidence("Radiculopathy / Peripheral Nerve Involvement", t),
      nextSteps: [
        "Upload neurology notes, spine records, DBQs, EMG or nerve testing, and treatment records.",
        "Clarify which extremity is affected, severity, weakness, numbness, and flare-ups."
      ],
      important: [
        "Peripheral nerve ratings depend on the specific nerve and degree of incomplete or complete paralysis.",
        "Final ratings depend on the full record, exam findings, and adjudicator review."
      ]
    });
  }

  return renderBlock({
    condition: "Radiculopathy / Peripheral Nerve Involvement",
    diagnosticCode: "4.124a starter estimate",
    rating: 10,
      confidence: "Low",
    reasoning: [
      "A nerve-related condition may be suggested, but the text describes only limited compensable details.",
      "More detail is needed to support a higher estimate."
    ],
    nextSteps: [
      "Upload neurology notes, spine records, DBQs, EMG or nerve testing, and treatment records.",
      "Clarify which extremity is affected, severity, weakness, numbness, and gait or work impact."
    ],
    important: [
      "Peripheral nerve ratings depend on the specific nerve and degree of incomplete or complete paralysis.",
      "Final ratings depend on the full record, exam findings, and adjudicator review."
    ]
  });
}

function analyzeKnee(t) {
  const severe = hasAny(t, [
    "instability",
    "gives out",
    "falls",
    "locking",
    "frequent locking",
    "cannot kneel",
    "cannot squat",
    "severe pain",
    "swelling",
    "brace",
    "misses work"
  ]);

  const moderate = hasAny(t, [
    "painful motion",
    "pain with stairs",
    "pain with walking",
    "pain with standing",
    "limited bending",
    "limited extension",
    "flare-ups",
    "crepitus",
    "swelling"
  ]);

  if (severe) {
    return renderBlock({
      condition: "Knee Condition",
      diagnosticCode: "Knee / Rating Formula Starter Estimate",
      rating: 20,
      confidence: "Medium",
      reasoning: [
        "The statement describes a knee condition with instability, locking, or significant functional limitation.",
        "The text suggests more than mild impairment."
      ],
      evidenceNeeded: buildMissingEvidence("Knee Condition", t),
      nextSteps: [
        "Upload orthopedic records, imaging, DBQs, and range-of-motion findings.",
        "Document instability, falls, brace use, locking, swelling, and limits on walking, kneeling, or stairs.",
        "Clarify flare-ups and work impact."
      ],
      important: [
        "Knee ratings often depend on limitation of motion, instability, and meniscal findings.",
        "Final ratings depend on the full record, exam findings, and adjudicator review."
      ]
    });
  }

  if (moderate) {
    return renderBlock({
      condition: "Knee Condition",
      diagnosticCode: "Knee / Rating Formula Starter Estimate",
      rating: 10,
      confidence: "Low",
      reasoning: [
        "The statement describes a knee condition with painful motion or moderate functional limitation.",
        "The text supports at least a compensable starter estimate."
      ],
      evidenceNeeded: buildMissingEvidence("Knee Condition", t),
      nextSteps: [
        "Upload orthopedic records, imaging, DBQs, and range-of-motion findings.",
        "Document stairs, walking, kneeling, flare-ups, and daily function impact."
      ],
      important: [
        "Knee ratings often depend on limitation of motion, instability, and meniscal findings.",
        "Final ratings depend on the full record, exam findings, and adjudicator review."
      ]
    });
  }

  return renderBlock({
    condition: "Knee Condition",
    diagnosticCode: "Knee / Rating Formula Starter Estimate",
    rating: 0,
      confidence: "Low",
    reasoning: [
      "A knee condition may be described, but the text does not yet clearly establish compensable functional loss or painful motion criteria.",
      "More detail is needed to support a higher estimate."
    ],
    nextSteps: [
      "Upload orthopedic records, imaging, DBQs, and range-of-motion findings.",
      "Clarify painful motion, instability, flare-ups, stairs, kneeling, and work impact."
    ],
    important: [
      "Knee ratings often depend on limitation of motion, instability, and meniscal findings.",
      "Final ratings depend on the full record, exam findings, and adjudicator review."
    ]
  });
}

function analyzeSleepApnea(t) {
  const cpap = hasAny(t, [
    "cpap",
    "bipap",
    "breathing assistance device",
    "uses cpap",
    "prescribed cpap"
  ]);

  const chronicFailure = hasAny(t, [
    "respiratory failure",
    "carbon dioxide retention",
    "cor pulmonale",
    "tracheostomy"
  ]);

  const persistentDaytime = hasAny(t, [
    "daytime hypersomnolence",
    "daytime sleepiness",
    "falls asleep during day",
    "excessive daytime sleepiness",
    "persistent daytime"
  ]);

  if (chronicFailure) {
    return renderBlock({
      condition: "Sleep Apnea",
      diagnosticCode: "6847",
      rating: 100,
      confidence: "Medium",
      reasoning: [
        "The statement suggests very severe sleep apnea criteria such as respiratory failure, cor pulmonale, or tracheostomy-level severity.",
        "The text supports the highest starter estimate."
      ],
      evidenceNeeded: buildMissingEvidence("Sleep Apnea", t),
      nextSteps: [
        "Upload sleep study, pulmonary records, hospital records, DBQs, and respiratory specialist notes.",
        "Clarify respiratory complications and device or surgical history."
      ],
      important: [
        "Do not assign 100 percent for sleep apnea without very strong objective signals.",
        "Final ratings depend on the full record and adjudicator review."
      ]
    });
  }

  if (cpap) {
    return renderBlock({
      condition: "Sleep Apnea",
      diagnosticCode: "6847",
      rating: 50,
      confidence: "High",
      reasoning: [
        "The statement indicates required use of a CPAP, BiPAP, or other breathing assistance device.",
        "That generally supports the standard 50 percent schedular level."
      ],
      evidenceNeeded: buildMissingEvidence("Sleep Apnea", t),
      nextSteps: [
        "Upload sleep study, CPAP prescription, compliance records, DBQs, and treatment notes.",
        "Clarify when the device was prescribed and current use."
      ],
      important: [
        "A CPAP-type device is a key objective gate for a 50 percent estimate.",
        "Final ratings depend on the full record and adjudicator review."
      ]
    });
  }

  if (persistentDaytime) {
    return renderBlock({
      condition: "Sleep Apnea",
      diagnosticCode: "6847",
      rating: 30,
      confidence: "Medium",
      reasoning: [
        "The statement suggests persistent daytime hypersomnolence without confirmed device criteria.",
        "That supports a 30 percent starter estimate."
      ],
      evidenceNeeded: buildMissingEvidence("Sleep Apnea", t),
      nextSteps: [
        "Upload sleep study, treatment notes, DBQs, and lay statements.",
        "Clarify daytime sleepiness, snoring, witnessed apneas, and whether a device was prescribed."
      ],
      important: [
        "A 30 percent estimate should be used conservatively without objective testing.",
        "Final ratings depend on the full record and adjudicator review."
      ]
    });
  }

  return renderBlock({
    condition: "Sleep Apnea",
    diagnosticCode: "6847",
    rating: 0,
      confidence: "Low",
    reasoning: [
      "Sleep apnea may be suggested, but the text does not yet establish compensable schedular criteria.",
      "More detail is needed about testing, symptoms, and treatment."
    ],
    nextSteps: [
      "Upload sleep study, treatment notes, DBQs, and lay statements.",
      "Clarify snoring, witnessed apneas, daytime sleepiness, and device requirements."
    ],
    important: [
      "Sleep apnea should not be over-scored without sleep-study and treatment data.",
      "Final ratings depend on the full record and adjudicator review."
    ]
  });
}

function analyzeGERD(t) {
  const severe = hasAny(t, [
    "material weight loss",
    "hematemesis",
    "melena",
    "anemia",
    "vomiting",
    "severe impairment of health"
  ]);

  const moderate = hasAny(t, [
    "dysphagia",
    "pyrosis",
    "heartburn",
    "regurgitation",
    "substernal pain",
    "arm pain",
    "shoulder pain",
    "epigastric distress"
  ]);

  if (severe) {
    return renderBlock({
      condition: "GERD / Reflux",
      diagnosticCode: "7346-style starter estimate",
      rating: 60,
      confidence: "Medium",
      reasoning: [
        "The statement suggests severe reflux-type symptom combinations such as vomiting, weight loss, bleeding, anemia, or severe impairment of health.",
        "The text supports a high starter estimate."
      ],
      evidenceNeeded: buildMissingEvidence("GERD / Reflux", t),
      nextSteps: [
        "Upload GI treatment notes, endoscopy results, DBQs, prescriptions, and lab records.",
        "Clarify weight change, bleeding, anemia, vomiting, and overall health impact."
      ],
      important: [
        "GERD estimates should stay conservative and evidence-based.",
        "Final ratings depend on the full record and adjudicator review."
      ]
    });
  }

  if (moderate) {
    return renderBlock({
      condition: "GERD / Reflux",
      diagnosticCode: "7346-style starter estimate",
      rating: 30,
      confidence: "Medium",
      reasoning: [
        "The statement suggests recurring reflux-type symptoms such as heartburn, regurgitation, dysphagia, or substernal pain.",
        "The text supports a moderate starter estimate."
      ],
      evidenceNeeded: buildMissingEvidence("GERD / Reflux", t),
      nextSteps: [
        "Upload GI treatment notes, endoscopy results, DBQs, prescriptions, and symptom logs.",
        "Clarify frequency, severity, and whether symptoms impair work, sleep, or nutrition."
      ],
      important: [
        "GERD estimates should stay conservative and evidence-based.",
        "Final ratings depend on the full record and adjudicator review."
      ]
    });
  }

  return renderBlock({
    condition: "GERD / Reflux",
    diagnosticCode: "7346-style starter estimate",
    rating: 10,
      confidence: "Low",
    reasoning: [
      "Reflux-type symptoms are suggested, but the text does not clearly establish more severe digestive criteria.",
      "The statement currently supports only a lower starter estimate."
    ],
    nextSteps: [
      "Upload GI treatment notes, endoscopy results, DBQs, prescriptions, and symptom logs.",
      "Clarify dysphagia, regurgitation, pain, vomiting, weight loss, and health impact."
    ],
    important: [
      "GERD estimates should stay conservative and evidence-based.",
      "Final ratings depend on the full record and adjudicator review."
    ]
  });
}

function analyzeSinusRhinitis(t) {
  const polyps = hasAny(t, ["polyps", "nasal polyps"]);
  const obstruction = hasAny(t, [
    "obstruction",
    "blocked nose",
    "blocked nasal passage",
    "cannot breathe through nose",
    "greater than 50 percent obstruction",
    "complete obstruction"
  ]);

  const recurrentEpisodes = hasAny(t, [
    "recurrent sinus infections",
    "multiple infections",
    "repeated antibiotics",
    "incapacitating episodes",
    "non-incapacitating episodes",
    "purulent discharge",
    "crusting"
  ]);

  if (polyps) {
    return renderBlock({
      condition: "Rhinitis / Sinusitis",
      diagnosticCode: "6522 / 6510-6514 starter estimate",
      rating: 30,
      confidence: "Medium",
      reasoning: [
        "The statement describes rhinitis or sinusitis-type symptoms.",
        "Nasal polyps are specifically described, which supports a higher rhinitis-style estimate."
      ],
      evidenceNeeded: buildMissingEvidence("Rhinitis / Sinusitis", t),
      nextSteps: [
        "Upload ENT records, imaging, DBQs, antibiotic history, and treatment notes.",
        "Clarify obstruction, polyps, and number of sinus episodes per year."
      ],
      important: [
        "Rhinitis and sinusitis should be tied to objective findings and episode counts.",
        "Final ratings depend on the full record and adjudicator review."
      ]
    });
  }

  if (obstruction || recurrentEpisodes) {
    return renderBlock({
      condition: "Rhinitis / Sinusitis",
      diagnosticCode: "6522 / 6510-6514 starter estimate",
      rating: 10,
      confidence: "Low",
      reasoning: [
        "The statement describes rhinitis or sinusitis-type symptoms.",
        "The text suggests nasal obstruction or recurrent episodes, which can support a compensable estimate."
      ],
      evidenceNeeded: buildMissingEvidence("Rhinitis / Sinusitis", t),
      nextSteps: [
        "Upload ENT records, imaging, DBQs, antibiotic history, and treatment notes.",
        "Clarify obstruction severity, episode count, and whether antibiotics were required."
      ],
      important: [
        "Rhinitis and sinusitis should be tied to objective findings and episode counts.",
        "Final ratings depend on the full record and adjudicator review."
      ]
    });
  }

  return renderBlock({
    condition: "Rhinitis / Sinusitis",
    diagnosticCode: "6522 / 6510-6514 starter estimate",
    rating: 0,
      confidence: "Low",
    reasoning: [
      "A sinus or rhinitis condition may be suggested, but the text does not clearly establish compensable criteria yet.",
      "More detail is needed about obstruction, polyps, and episodes."
    ],
    nextSteps: [
      "Upload ENT records, imaging, DBQs, antibiotic history, and treatment notes.",
      "Clarify obstruction, polyps, and annual episode count."
    ],
    important: [
      "Rhinitis and sinusitis should be tied to objective findings and episode counts.",
      "Final ratings depend on the full record and adjudicator review."
    ]
  });
}

function analyzeScars(t) {
  const painful = hasAny(t, [
    "painful scar",
    "painful scars",
    "tender scar",
    "unstable scar",
    "unstable scars"
  ]);

  const faceNeck = hasAny(t, [
    "face",
    "neck",
    "head",
    "disfigurement"
  ]);

  const largeArea = hasAny(t, [
    "large area",
    "deep scar",
    "burn scar",
    "multiple scars",
    "wide scar"
  ]);

  if (faceNeck) {
    return renderBlock({
      condition: "Scars",
      diagnosticCode: "7800-7805 starter estimate",
      rating: 30,
      confidence: "Medium",
      reasoning: [
        "The statement suggests a scar involving the head, face, or neck, or potential disfigurement criteria.",
        "That can support a higher starter estimate depending on objective characteristics."
      ],
      evidenceNeeded: buildMissingEvidence("Scars", t),
      nextSteps: [
        "Upload clear photographs, measurements, DBQs, and treatment records.",
        "Document pain, instability, disfigurement features, and functional limitation."
      ],
      important: [
        "Scar ratings should be driven by location, size, pain, instability, and measured characteristics.",
        "Final ratings depend on the full record and adjudicator review."
      ]
    });
  }

  if (painful || largeArea) {
    return renderBlock({
      condition: "Scars",
      diagnosticCode: "7801-7805 starter estimate",
      rating: 10,
      confidence: "Low",
      reasoning: [
        "The statement suggests painful, unstable, deep, or otherwise compensable scar features.",
        "The text supports at least a starter compensable estimate."
      ],
      evidenceNeeded: buildMissingEvidence("Scars", t),
      nextSteps: [
        "Upload clear photographs, measurements, DBQs, and treatment records.",
        "Document pain, instability, size, and any functional limitation caused by the scar."
      ],
      important: [
        "Scar ratings should be driven by location, size, pain, instability, and measured characteristics.",
        "Final ratings depend on the full record and adjudicator review."
      ]
    });
  }

  return renderBlock({
    condition: "Scars",
    diagnosticCode: "7800-7805 starter estimate",
    rating: 0,
      confidence: "Low",
    reasoning: [
      "A scar may be described, but the text does not clearly establish compensable criteria such as pain, instability, size, or disfigurement.",
      "More detail is needed to support a higher estimate."
    ],
    nextSteps: [
      "Upload clear photographs, measurements, DBQs, and treatment records.",
      "Clarify pain, instability, size, location, and function impact."
    ],
    important: [
      "Scar ratings should be driven by location, size, pain, instability, and measured characteristics.",
      "Final ratings depend on the full record and adjudicator review."
    ]
  });
}

function analyzeHearingLoss(t) {
  return renderBlock({
    condition: "Hearing Loss",
    diagnosticCode: "4.85 / 4.86 framework starter output",
    rating: 0,
      confidence: "Low",
    reasoning: [
      "Hearing loss is suggested, but plain symptom text alone is not enough to estimate a schedular percentage reliably.",
      "VA hearing loss ratings are driven by audiometric testing rather than narrative symptoms alone."
    ],
    nextSteps: [
      "Upload the audiology report, Maryland CNC results, puretone thresholds, DBQs, and treatment notes.",
      "Clarify whether the hearing loss has been formally diagnosed and tested for VA purposes."
    ],
    important: [
      "Do not treat narrative hearing-loss text as enough for a percentage estimate.",
      "Final ratings depend on the full record, audiology data, and adjudicator review."
    ]
  });
}

function analyzeCfr38(raw) {
  const t = String(raw || "").toLowerCase();

  if (hasAny(t, ["migraine", "headache"])) {
    return analyzeMigraines(t);
  }

  if (hasAny(t, [
    "ptsd",
    "post traumatic stress",
    "post-traumatic stress",
    "anxiety",
    "depression",
    "panic",
    "nightmares",
    "mental health",
    "irritability",
    "hypervigilance"
  ])) {
    return analyzeMentalHealth(t);
  }

  if (hasAny(t, ["tinnitus", "ringing in ears", "ringing in ear", "ringing"])) {
    return analyzeTinnitus(t);
  }

  if (hasAny(t, [
    "lumbar",
    "lower back",
    "back pain",
    "thoracolumbar",
    "sciatica"
  ])) {
    return analyzeLumbarBack(t);
  }

  if (hasAny(t, ["radiculopathy", "radiates down leg", "shooting pain", "numbness", "tingling"])) {
    return analyzeRadiculopathy(t);
  }

  if (hasAny(t, ["knee", "knees", "patella", "meniscus", "acl", "mcl"])) {
    return analyzeKnee(t);
  }

  if (hasAny(t, ["sleep apnea", "cpap", "bipap", "snoring", "witnessed apneas", "daytime hypersomnolence"])) {
    return analyzeSleepApnea(t);
  }

  if (hasAny(t, ["gerd", "reflux", "heartburn", "regurgitation", "dysphagia", "pyrosis", "epigastric"])) {
    return analyzeGERD(t);
  }

  if (hasAny(t, ["sinusitis", "rhinitis", "sinus infection", "nasal obstruction", "polyps"])) {
    return analyzeSinusRhinitis(t);
  }

  if (hasAny(t, ["scar", "scars", "disfigurement", "burn scar"])) {
    return analyzeScars(t);
  }

  if (hasAny(t, ["hearing loss", "hearing impairment", "cannot hear", "hard of hearing"])) {
    return analyzeHearingLoss(t);
  }

  return fallbackResult(raw);
}

module.exports = {
  analyzeCfr38,
  fallbackResult,
  combineVaRatings
};
