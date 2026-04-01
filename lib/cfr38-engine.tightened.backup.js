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
- This is a starter estimate only.
- Final ratings depend on the full medical and service record, exam findings, and adjudicator review.`;
}

function hasAny(t, terms) {
  return terms.some((term) => t.includes(term));
}

function renderBlock({ condition, diagnosticCode, rating, reasoning, nextSteps, important }) {
  return [
    `Condition: ${condition}`,
    diagnosticCode ? `Diagnostic Code: ${diagnosticCode}` : null,
    `Estimated VA Rating: ${rating}%`,
    ``,
    `Reasoning:`,
    ...reasoning.map((x) => `- ${x}`),
    ``,
    `Next Steps:`,
    ...nextSteps.map((x) => `- ${x}`),
    ``,
    `Important:`,
    ...important.map((x) => `- ${x}`)
  ].filter(Boolean).join("\n");
}

function fallbackResultWithCondition(condition, code, extraReasoning) {
  return renderBlock({
    condition,
    diagnosticCode: code,
    rating: 0,
    reasoning: extraReasoning,
    nextSteps: [
      "Upload diagnosis records, DBQs, treatment notes, and objective testing.",
      "Clarify frequency, duration, severity, and functional impact.",
      "Add work impact, sleep impact, flare-ups, and activity limits where relevant."
    ],
    important: [
      "This is a starter estimate only.",
      "Final ratings depend on the full record, exam findings, and adjudicator review."
    ]
  });
}

function analyzeMigraines(t) {
  const monthly34 =
    hasAny(t, [
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

  const prostrating =
    hasAny(t, [
      "lie down",
      "lay down",
      "dark room",
      "prostrating",
      "light sensitivity",
      "photophobia",
      "nausea",
      "vomiting"
    ]);

  const severeImpact =
    hasAny(t, [
      "misses work",
      "missed work",
      "unable to work",
      "call out",
      "call off",
      "reduced productivity",
      "economic impact",
      "leave work early",
      "flare-ups"
    ]);

  if (prostrating && monthly34 && severeImpact) {
    return renderBlock({
      condition: "Migraines / Headaches",
      diagnosticCode: "8100",
      rating: 50,
      reasoning: [
        "Headaches or migraines are described.",
        "The statement supports characteristic prostrating attacks.",
        "Frequency appears around 3 to 4 times per month.",
        "The statement also describes economic or work impact."
      ],
      nextSteps: [
        "Keep a migraine log with date, duration, and whether you had to lie down.",
        "Document missed work, reduced productivity, or leaving early.",
        "Upload treatment records, prescriptions, DBQs, and supporting statements.",
        "Clarify whether attacks are completely prostrating and how long they last."
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
      reasoning: [
        "Headaches or migraines are described.",
        "The statement supports characteristic prostrating attacks.",
        "Frequency appears at least monthly."
      ],
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

function analyzeMentalHealth(t) {
  const totalImpairment = hasAny(t, [
    "gross impairment",
    "persistent danger",
    "danger to self",
    "danger to others",
    "disorientation",
    "hallucinations",
    "delusions",
    "unable to maintain hygiene",
    "memory loss for names of close relatives"
  ]);

  const deficienciesMostAreas = hasAny(t, [
    "suicidal ideation",
    "obsessional rituals",
    "near-continuous panic",
    "near continuous panic",
    "near-continuous depression",
    "impaired impulse control",
    "violence",
    "neglect of personal appearance",
    "inability to adapt",
    "cannot adapt to stressful circumstances",
    "deficiencies in most areas"
  ]);

  const reducedReliability = hasAny(t, [
    "panic attacks more than once a week",
    "impaired judgment",
    "impaired abstract thinking",
    "disturbances of motivation",
    "disturbances of mood",
    "difficulty establishing relationships",
    "difficulty maintaining relationships",
    "flattened affect",
    "reduced reliability",
    "reduced productivity"
  ]);

  const occasionalDecrease = hasAny(t, [
    "anxiety",
    "depressed mood",
    "chronic sleep impairment",
    "sleep impairment",
    "nightmares",
    "panic attacks weekly or less often",
    "mild memory loss",
    "suspiciousness"
  ]);

  if (totalImpairment) {
    return renderBlock({
      condition: "PTSD / Mental Health",
      diagnosticCode: "9411 / General Rating Formula for Mental Disorders",
      rating: 100,
      reasoning: [
        "The statement suggests total occupational and social impairment features.",
        "Very severe mental health indicators are present in the text."
      ],
      nextSteps: [
        "Upload mental health treatment records, hospitalization records, DBQs, and lay statements.",
        "Document social and occupational impairment in detail.",
        "Clarify safety concerns, supervision needs, and inability to function independently."
      ],
      important: [
        "Mental health ratings turn heavily on level of occupational and social impairment.",
        "Final ratings depend on the full record and adjudicator review."
      ]
    });
  }

  if (deficienciesMostAreas) {
    return renderBlock({
      condition: "PTSD / Mental Health",
      diagnosticCode: "9411 / General Rating Formula for Mental Disorders",
      rating: 70,
      reasoning: [
        "The statement suggests deficiencies in most areas such as work, family relations, judgment, thinking, or mood.",
        "Severe mental health indicators are present in the text."
      ],
      nextSteps: [
        "Upload therapy notes, psychiatric records, DBQs, medication history, and lay statements.",
        "Document work problems, family strain, panic, depression, anger, and impaired adaptation.",
        "Clarify frequency, severity, and duration of symptoms."
      ],
      important: [
        "Mental health ratings turn heavily on level of occupational and social impairment.",
        "Final ratings depend on the full record and adjudicator review."
      ]
    });
  }

  if (reducedReliability) {
    return renderBlock({
      condition: "PTSD / Mental Health",
      diagnosticCode: "9411 / General Rating Formula for Mental Disorders",
      rating: 50,
      reasoning: [
        "The statement suggests reduced reliability and productivity.",
        "The text describes moderate ongoing mental health impairment."
      ],
      nextSteps: [
        "Upload therapy notes, psychiatric records, DBQs, medication history, and statements from family or coworkers.",
        "Document panic frequency, concentration issues, relationship difficulty, and work impact."
      ],
      important: [
        "Mental health ratings turn heavily on level of occupational and social impairment.",
        "Final ratings depend on the full record and adjudicator review."
      ]
    });
  }

  if (occasionalDecrease) {
    return renderBlock({
      condition: "PTSD / Mental Health",
      diagnosticCode: "9411 / General Rating Formula for Mental Disorders",
      rating: 30,
      reasoning: [
        "The statement suggests occasional decrease in work efficiency with intermittent periods of inability to perform tasks.",
        "The text describes symptoms such as anxiety, sleep impairment, nightmares, or depressed mood."
      ],
      nextSteps: [
        "Upload treatment records, prescriptions, DBQs, and lay statements.",
        "Document sleep problems, panic, irritability, and work or family impact."
      ],
      important: [
        "Mental health ratings turn heavily on level of occupational and social impairment.",
        "Final ratings depend on the full record and adjudicator review."
      ]
    });
  }

  return renderBlock({
    condition: "PTSD / Mental Health",
    diagnosticCode: "9411 / General Rating Formula for Mental Disorders",
    rating: 10,
    reasoning: [
      "A mental health condition is suggested, but the text describes only mild or limited functional impact.",
      "The statement does not clearly establish higher-level occupational and social impairment criteria."
    ],
    nextSteps: [
      "Upload treatment records, diagnosis, DBQs, and lay statements.",
      "Clarify work impact, social impairment, panic frequency, sleep impairment, and medication history."
    ],
    important: [
      "Mental health ratings turn heavily on level of occupational and social impairment.",
      "Final ratings depend on the full record and adjudicator review."
    ]
  });
}

function analyzeTinnitus(t) {
  return renderBlock({
    condition: "Tinnitus",
    diagnosticCode: "6260",
    rating: 10,
    reasoning: [
      "Tinnitus is described in the statement.",
      "Under the standard VA schedule, recurrent tinnitus generally carries a single 10 percent evaluation."
    ],
    nextSteps: [
      "Document onset, noise exposure, and whether ringing is constant or recurrent.",
      "Upload audiology records, hearing tests, and statements about in-service noise exposure.",
      "Clarify service connection theory, such as weapons, aircraft, generators, or machinery."
    ],
    important: [
      "The standard schedular rating for recurrent tinnitus is generally 10%.",
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
      reasoning: [
        "The statement describes a lumbar back condition with significant functional loss, flare-ups, or neurologic-type symptoms.",
        "The text suggests more severe limitation or complications that can support a higher evaluation."
      ],
      nextSteps: [
        "Upload imaging, treatment records, DBQs, and range-of-motion findings.",
        "Document flare-ups, inability to bend, standing tolerance, sitting tolerance, and work impact.",
        "Clarify whether pain radiates, causes numbness, or affects walking or lifting."
      ],
      important: [
        "Spine ratings often turn on range-of-motion findings, flare-up evidence, and neurologic involvement.",
        "Final ratings depend on the full record, exam findings, and adjudicator review."
      ]
    });
  }

  if (moderate) {
    return renderBlock({
      condition: "Lumbar Back Condition",
      diagnosticCode: "Thoracolumbar Spine / Rating Formula Starter Estimate",
      rating: 20,
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
        "Spine ratings often turn on range-of-motion findings, flare-up evidence, and neurologic involvement.",
        "Final ratings depend on the full record, exam findings, and adjudicator review."
      ]
    });
  }

  return renderBlock({
    condition: "Lumbar Back Condition",
    diagnosticCode: "Thoracolumbar Spine / Rating Formula Starter Estimate",
    rating: 10,
    reasoning: [
      "A lumbar back condition is described, but the text currently supports only mild painful motion or limited functional detail.",
      "The statement does not clearly establish the higher-level criteria."
    ],
    nextSteps: [
      "Upload treatment records, imaging, DBQs, and range-of-motion findings.",
      "Clarify flare-ups, motion loss, and work or daily activity impact."
    ],
    important: [
      "Spine ratings often turn on range-of-motion findings, flare-up evidence, and neurologic involvement.",
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
      reasoning: [
        "The statement describes a knee condition with instability, locking, or significant functional limitation.",
        "The text suggests more than mild impairment."
      ],
      nextSteps: [
        "Upload orthopedic records, imaging, DBQs, and range-of-motion findings.",
        "Document instability, falls, brace use, locking, swelling, and limits on walking, kneeling, or stairs.",
        "Clarify flare-ups and work impact."
      ],
      important: [
        "Knee ratings often depend on limitation of flexion, limitation of extension, instability, and meniscal findings.",
        "Final ratings depend on the full record, exam findings, and adjudicator review."
      ]
    });
  }

  if (moderate) {
    return renderBlock({
      condition: "Knee Condition",
      diagnosticCode: "Knee / Rating Formula Starter Estimate",
      rating: 10,
      reasoning: [
        "The statement describes a knee condition with painful motion or moderate functional limitation.",
        "The text supports at least a compensable starter estimate."
      ],
      nextSteps: [
        "Upload orthopedic records, imaging, DBQs, and range-of-motion findings.",
        "Document stairs, walking, kneeling, flare-ups, and daily function impact."
      ],
      important: [
        "Knee ratings often depend on limitation of flexion, limitation of extension, instability, and meniscal findings.",
        "Final ratings depend on the full record, exam findings, and adjudicator review."
      ]
    });
  }

  return renderBlock({
    condition: "Knee Condition",
    diagnosticCode: "Knee / Rating Formula Starter Estimate",
    rating: 0,
    reasoning: [
      "A knee condition may be described, but the text does not yet clearly establish compensable functional loss or painful motion criteria.",
      "More detail is needed to support a higher estimate."
    ],
    nextSteps: [
      "Upload orthopedic records, imaging, DBQs, and range-of-motion findings.",
      "Clarify painful motion, instability, flare-ups, stairs, kneeling, and work impact."
    ],
    important: [
      "Knee ratings often depend on limitation of flexion, limitation of extension, instability, and meniscal findings.",
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
      reasoning: [
        "The statement suggests very severe sleep apnea criteria such as respiratory failure, cor pulmonale, or tracheostomy-level severity.",
        "The text supports the highest starter estimate."
      ],
      nextSteps: [
        "Upload sleep study, pulmonary records, hospital records, DBQs, and respiratory specialist notes.",
        "Clarify respiratory complications and device or surgical history."
      ],
      important: [
        "Sleep apnea ratings turn heavily on sleep study findings and treatment requirements.",
        "Final ratings depend on the full record and adjudicator review."
      ]
    });
  }

  if (cpap) {
    return renderBlock({
      condition: "Sleep Apnea",
      diagnosticCode: "6847",
      rating: 50,
      reasoning: [
        "The statement indicates required use of a CPAP, BiPAP, or other breathing assistance device.",
        "That generally supports the standard 50 percent schedular level."
      ],
      nextSteps: [
        "Upload sleep study, CPAP prescription, compliance records, DBQs, and treatment notes.",
        "Clarify when the device was prescribed and current use."
      ],
      important: [
        "Sleep apnea ratings turn heavily on sleep study findings and treatment requirements.",
        "Final ratings depend on the full record and adjudicator review."
      ]
    });
  }

  if (persistentDaytime) {
    return renderBlock({
      condition: "Sleep Apnea",
      diagnosticCode: "6847",
      rating: 30,
      reasoning: [
        "The statement suggests persistent daytime hypersomnolence without confirmed device criteria.",
        "That supports a 30 percent starter estimate."
      ],
      nextSteps: [
        "Upload sleep study, treatment notes, DBQs, and lay statements.",
        "Clarify daytime sleepiness, snoring, witnessed apneas, and whether a device was prescribed."
      ],
      important: [
        "Sleep apnea ratings turn heavily on sleep study findings and treatment requirements.",
        "Final ratings depend on the full record and adjudicator review."
      ]
    });
  }

  return renderBlock({
    condition: "Sleep Apnea",
    diagnosticCode: "6847",
    rating: 0,
    reasoning: [
      "Sleep apnea may be suggested, but the text does not yet establish compensable schedular criteria.",
      "More detail is needed about testing, symptoms, and treatment."
    ],
    nextSteps: [
      "Upload sleep study, treatment notes, DBQs, and lay statements.",
      "Clarify snoring, witnessed apneas, daytime sleepiness, and device requirements."
    ],
    important: [
      "Sleep apnea ratings turn heavily on sleep study findings and treatment requirements.",
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
      reasoning: [
        "The statement suggests severe reflux-type symptom combinations such as vomiting, weight loss, bleeding, anemia, or severe impairment of health.",
        "The text supports a high starter estimate."
      ],
      nextSteps: [
        "Upload GI treatment notes, endoscopy results, DBQs, prescriptions, and lab records.",
        "Clarify weight change, bleeding, anemia, vomiting, and overall health impact."
      ],
      important: [
        "GERD and reflux coding can involve analogous ratings and evolving digestive-system criteria.",
        "Final ratings depend on the full record and adjudicator review."
      ]
    });
  }

  if (moderate) {
    return renderBlock({
      condition: "GERD / Reflux",
      diagnosticCode: "7346-style starter estimate",
      rating: 30,
      reasoning: [
        "The statement suggests recurring reflux-type symptoms such as heartburn, regurgitation, dysphagia, or substernal pain.",
        "The text supports a moderate starter estimate."
      ],
      nextSteps: [
        "Upload GI treatment notes, endoscopy results, DBQs, prescriptions, and symptom logs.",
        "Clarify frequency, severity, and whether symptoms impair work, sleep, or nutrition."
      ],
      important: [
        "GERD and reflux coding can involve analogous ratings and evolving digestive-system criteria.",
        "Final ratings depend on the full record and adjudicator review."
      ]
    });
  }

  return renderBlock({
    condition: "GERD / Reflux",
    diagnosticCode: "7346-style starter estimate",
    rating: 10,
    reasoning: [
      "Reflux-type symptoms are suggested, but the text does not clearly establish more severe digestive criteria.",
      "The statement currently supports only a lower starter estimate."
    ],
    nextSteps: [
      "Upload GI treatment notes, endoscopy results, DBQs, prescriptions, and symptom logs.",
      "Clarify dysphagia, regurgitation, pain, vomiting, weight loss, and health impact."
    ],
    important: [
      "GERD and reflux coding can involve analogous ratings and evolving digestive-system criteria.",
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
    "non-incapacitating episodes"
  ]);

  if (polyps) {
    return renderBlock({
      condition: "Rhinitis / Sinusitis",
      diagnosticCode: "6522 / 6510-6514 starter estimate",
      rating: 30,
      reasoning: [
        "The statement describes rhinitis or sinusitis-type symptoms.",
        "Nasal polyps are specifically described, which supports a higher rhinitis-style estimate."
      ],
      nextSteps: [
        "Upload ENT records, imaging, DBQs, antibiotic history, and treatment notes.",
        "Clarify obstruction, polyps, and number of sinus episodes per year."
      ],
      important: [
        "Rhinitis and sinusitis ratings depend heavily on objective findings and episode counts.",
        "Final ratings depend on the full record and adjudicator review."
      ]
    });
  }

  if (obstruction || recurrentEpisodes) {
    return renderBlock({
      condition: "Rhinitis / Sinusitis",
      diagnosticCode: "6522 / 6510-6514 starter estimate",
      rating: 10,
      reasoning: [
        "The statement describes rhinitis or sinusitis-type symptoms.",
        "The text suggests nasal obstruction or recurrent episodes, which can support a compensable estimate."
      ],
      nextSteps: [
        "Upload ENT records, imaging, DBQs, antibiotic history, and treatment notes.",
        "Clarify obstruction severity, episode count, and whether antibiotics were required."
      ],
      important: [
        "Rhinitis and sinusitis ratings depend heavily on objective findings and episode counts.",
        "Final ratings depend on the full record and adjudicator review."
      ]
    });
  }

  return renderBlock({
    condition: "Rhinitis / Sinusitis",
    diagnosticCode: "6522 / 6510-6514 starter estimate",
    rating: 0,
    reasoning: [
      "A sinus or rhinitis condition may be suggested, but the text does not clearly establish compensable criteria yet.",
      "More detail is needed about obstruction, polyps, and episodes."
    ],
    nextSteps: [
      "Upload ENT records, imaging, DBQs, antibiotic history, and treatment notes.",
      "Clarify obstruction, polyps, and annual episode count."
    ],
    important: [
      "Rhinitis and sinusitis ratings depend heavily on objective findings and episode counts.",
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
      reasoning: [
        "The statement suggests a scar involving the head, face, or neck, or potential disfigurement criteria.",
        "That can support a higher starter estimate depending on objective characteristics."
      ],
      nextSteps: [
        "Upload clear photographs, measurements, DBQs, and treatment records.",
        "Document pain, instability, disfigurement features, and functional limitation."
      ],
      important: [
        "Scar ratings depend heavily on location, size, pain, instability, and objective measurements.",
        "Final ratings depend on the full record and adjudicator review."
      ]
    });
  }

  if (painful || largeArea) {
    return renderBlock({
      condition: "Scars",
      diagnosticCode: "7801-7805 starter estimate",
      rating: 10,
      reasoning: [
        "The statement suggests painful, unstable, deep, or otherwise compensable scar features.",
        "The text supports at least a starter compensable estimate."
      ],
      nextSteps: [
        "Upload clear photographs, measurements, DBQs, and treatment records.",
        "Document pain, instability, size, and any functional limitation caused by the scar."
      ],
      important: [
        "Scar ratings depend heavily on location, size, pain, instability, and objective measurements.",
        "Final ratings depend on the full record and adjudicator review."
      ]
    });
  }

  return renderBlock({
    condition: "Scars",
    diagnosticCode: "7800-7805 starter estimate",
    rating: 0,
    reasoning: [
      "A scar may be described, but the text does not clearly establish compensable criteria such as pain, instability, size, or disfigurement.",
      "More detail is needed to support a higher estimate."
    ],
    nextSteps: [
      "Upload clear photographs, measurements, DBQs, and treatment records.",
      "Clarify pain, instability, size, location, and function impact."
    ],
    important: [
      "Scar ratings depend heavily on location, size, pain, instability, and objective measurements.",
      "Final ratings depend on the full record and adjudicator review."
    ]
  });
}

function analyzeHearingLoss(t) {
  return renderBlock({
    condition: "Hearing Loss",
    diagnosticCode: "4.85 / 4.86 framework starter output",
    rating: 0,
    reasoning: [
      "Hearing loss is suggested, but plain symptom text alone is not enough to estimate a schedular percentage reliably.",
      "VA hearing loss ratings are driven by audiometric testing rather than narrative symptoms alone."
    ],
    nextSteps: [
      "Upload the audiology report, Maryland CNC results, puretone thresholds, DBQs, and treatment notes.",
      "Clarify whether the hearing loss has been formally diagnosed and tested for VA purposes."
    ],
    important: [
      "A reliable hearing-loss percentage estimate requires formal audiology data.",
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
      reasoning: [
        "The statement suggests significant nerve involvement with severe sensory or motor features.",
        "The text supports a higher starter estimate."
      ],
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
      reasoning: [
        "The statement suggests radiating pain, numbness, tingling, or sciatica-type symptoms.",
        "The text supports a moderate starter estimate pending objective findings."
      ],
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
