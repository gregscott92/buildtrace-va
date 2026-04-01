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
    return `Condition: Migraines / Headaches
Diagnostic Code: 8100
Estimated VA Rating: 50%

Reasoning:
- Headaches or migraines are described.
- The statement supports characteristic prostrating attacks.
- Frequency appears around 3 to 4 times per month.
- The statement also describes economic or work impact.

Next Steps:
- Keep a migraine log with date, duration, and whether you had to lie down.
- Document missed work, reduced productivity, or leaving early.
- Upload treatment records, prescriptions, DBQs, and supporting statements.
- Clarify whether attacks are completely prostrating and how long they last.

Important:
- This is an estimate based on the entered facts.
- Final ratings depend on the full record and adjudicator review.`;
  }

  if (prostrating && monthly) {
    return `Condition: Migraines / Headaches
Diagnostic Code: 8100
Estimated VA Rating: 30%

Reasoning:
- Headaches or migraines are described.
- The statement supports characteristic prostrating attacks.
- Frequency appears at least monthly.

Next Steps:
- Keep a migraine log with date, duration, and whether you had to lie down.
- Upload treatment notes, prescriptions, DBQs, and statements.
- Clarify work impact and attack duration.

Important:
- This is an estimate based on the entered facts.
- Final ratings depend on the full record and adjudicator review.`;
  }

  return `Condition: Migraines / Headaches
Diagnostic Code: 8100
Estimated VA Rating: 10%

Reasoning:
- Headaches or migraines are described.
- Some prostrating-type features may be present.
- The statement does not clearly establish the higher-frequency criteria.

Next Steps:
- Document frequency over several months.
- State whether attacks require lying down or isolating in a dark room.
- State duration and work impact.
- Upload treatment records, prescriptions, DBQs, and supporting statements.

Important:
- This is an estimate based on the entered facts.
- Final ratings depend on the full record and adjudicator review.`;
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
    return `Condition: PTSD / Mental Health
Diagnostic Code: 9411 / General Rating Formula for Mental Disorders
Estimated VA Rating: 100%

Reasoning:
- The statement suggests total occupational and social impairment features.
- Very severe mental health indicators are present in the text.

Next Steps:
- Upload mental health treatment records, hospitalization records, DBQs, and lay statements.
- Document social and occupational impairment in detail.
- Clarify safety concerns, supervision needs, and inability to function independently.

Important:
- Mental health ratings turn heavily on level of occupational and social impairment.
- Final ratings depend on the full record and adjudicator review.`;
  }

  if (deficienciesMostAreas) {
    return `Condition: PTSD / Mental Health
Diagnostic Code: 9411 / General Rating Formula for Mental Disorders
Estimated VA Rating: 70%

Reasoning:
- The statement suggests deficiencies in most areas such as work, family relations, judgment, thinking, or mood.
- Severe mental health indicators are present in the text.

Next Steps:
- Upload therapy notes, psychiatric records, DBQs, medication history, and lay statements.
- Document work problems, family strain, panic, depression, anger, and impaired adaptation.
- Clarify frequency, severity, and duration of symptoms.

Important:
- Mental health ratings turn heavily on level of occupational and social impairment.
- Final ratings depend on the full record and adjudicator review.`;
  }

  if (reducedReliability) {
    return `Condition: PTSD / Mental Health
Diagnostic Code: 9411 / General Rating Formula for Mental Disorders
Estimated VA Rating: 50%

Reasoning:
- The statement suggests reduced reliability and productivity.
- The text describes moderate ongoing mental health impairment.

Next Steps:
- Upload therapy notes, psychiatric records, DBQs, medication history, and statements from family or coworkers.
- Document panic frequency, concentration issues, relationship difficulty, and work impact.

Important:
- Mental health ratings turn heavily on level of occupational and social impairment.
- Final ratings depend on the full record and adjudicator review.`;
  }

  if (occasionalDecrease) {
    return `Condition: PTSD / Mental Health
Diagnostic Code: 9411 / General Rating Formula for Mental Disorders
Estimated VA Rating: 30%

Reasoning:
- The statement suggests occasional decrease in work efficiency with intermittent periods of inability to perform tasks.
- The text describes symptoms such as anxiety, sleep impairment, nightmares, or depressed mood.

Next Steps:
- Upload treatment records, prescriptions, DBQs, and lay statements.
- Document sleep problems, panic, irritability, and work or family impact.

Important:
- Mental health ratings turn heavily on level of occupational and social impairment.
- Final ratings depend on the full record and adjudicator review.`;
  }

  return `Condition: PTSD / Mental Health
Diagnostic Code: 9411 / General Rating Formula for Mental Disorders
Estimated VA Rating: 10%

Reasoning:
- A mental health condition is suggested, but the text describes only mild or limited functional impact.
- The statement does not clearly establish higher-level occupational and social impairment criteria.

Next Steps:
- Upload treatment records, diagnosis, DBQs, and lay statements.
- Clarify work impact, social impairment, panic frequency, sleep impairment, and medication history.

Important:
- Mental health ratings turn heavily on level of occupational and social impairment.
- Final ratings depend on the full record and adjudicator review.`;
}

function analyzeTinnitus(t) {
  return `Condition: Tinnitus
Diagnostic Code: 6260
Estimated VA Rating: 10%

Reasoning:
- Tinnitus is described in the statement.
- Under the standard VA schedule, recurrent tinnitus generally carries a single 10 percent evaluation.

Next Steps:
- Document onset, noise exposure, and whether ringing is constant or recurrent.
- Upload audiology records, hearing tests, and statements about in-service noise exposure.
- Clarify service connection theory, such as weapons, aircraft, generators, or machinery.

Important:
- The standard schedular rating for recurrent tinnitus is generally 10%.
- Final ratings and service connection depend on the full record and adjudicator review.`;
}

function analyzeLumbarBack(t) {
  const severe =
    hasAny(t, [
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

  const moderate =
    hasAny(t, [
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
    return `Condition: Lumbar Back Condition
Diagnostic Code: Thoracolumbar Spine / Rating Formula Starter Estimate
Estimated VA Rating: 40%

Reasoning:
- The statement describes a lumbar back condition with significant functional loss, flare-ups, or neurologic-type symptoms.
- The text suggests more severe limitation or complications that can support a higher evaluation.

Next Steps:
- Upload imaging, treatment records, DBQs, and range-of-motion findings.
- Document flare-ups, inability to bend, standing tolerance, sitting tolerance, and work impact.
- Clarify whether pain radiates, causes numbness, or affects walking or lifting.

Important:
- Spine ratings often turn on range-of-motion findings, flare-up evidence, and neurologic involvement.
- Final ratings depend on the full record, exam findings, and adjudicator review.`;
  }

  if (moderate) {
    return `Condition: Lumbar Back Condition
Diagnostic Code: Thoracolumbar Spine / Rating Formula Starter Estimate
Estimated VA Rating: 20%

Reasoning:
- The statement describes a lumbar back condition with ongoing pain and functional limitation.
- The text suggests moderate impairment or flare-up activity.

Next Steps:
- Upload treatment records, imaging, DBQs, and range-of-motion findings.
- Document bending limits, lifting problems, standing tolerance, and flare-ups.
- Clarify whether symptoms radiate into the legs.

Important:
- Spine ratings often turn on range-of-motion findings, flare-up evidence, and neurologic involvement.
- Final ratings depend on the full record, exam findings, and adjudicator review.`;
  }

  return `Condition: Lumbar Back Condition
Diagnostic Code: Thoracolumbar Spine / Rating Formula Starter Estimate
Estimated VA Rating: 10%

Reasoning:
- A lumbar back condition is described, but the text currently supports only mild painful motion or limited functional detail.
- The statement does not clearly establish the higher-level criteria.

Next Steps:
- Upload treatment records, imaging, DBQs, and range-of-motion findings.
- Clarify flare-ups, motion loss, and work or daily activity impact.

Important:
- Spine ratings often turn on range-of-motion findings, flare-up evidence, and neurologic involvement.
- Final ratings depend on the full record, exam findings, and adjudicator review.`;
}

function analyzeKnee(t) {
  const severe =
    hasAny(t, [
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

  const moderate =
    hasAny(t, [
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
    return `Condition: Knee Condition
Diagnostic Code: Knee / Rating Formula Starter Estimate
Estimated VA Rating: 20%

Reasoning:
- The statement describes a knee condition with instability, locking, or significant functional limitation.
- The text suggests more than mild impairment.

Next Steps:
- Upload orthopedic records, imaging, DBQs, and range-of-motion findings.
- Document instability, falls, brace use, locking, swelling, and limits on walking, kneeling, or stairs.
- Clarify flare-ups and work impact.

Important:
- Knee ratings often depend on limitation of flexion, limitation of extension, instability, and meniscal findings.
- Final ratings depend on the full record, exam findings, and adjudicator review.`;
  }

  if (moderate) {
    return `Condition: Knee Condition
Diagnostic Code: Knee / Rating Formula Starter Estimate
Estimated VA Rating: 10%

Reasoning:
- The statement describes a knee condition with painful motion or moderate functional limitation.
- The text supports at least a compensable starter estimate.

Next Steps:
- Upload orthopedic records, imaging, DBQs, and range-of-motion findings.
- Document stairs, walking, kneeling, flare-ups, and daily function impact.

Important:
- Knee ratings often depend on limitation of flexion, limitation of extension, instability, and meniscal findings.
- Final ratings depend on the full record, exam findings, and adjudicator review.`;
  }

  return `Condition: Knee Condition
Diagnostic Code: Knee / Rating Formula Starter Estimate
Estimated VA Rating: 0%

Reasoning:
- A knee condition may be described, but the text does not yet clearly establish compensable functional loss or painful motion criteria.
- More detail is needed to support a higher estimate.

Next Steps:
- Upload orthopedic records, imaging, DBQs, and range-of-motion findings.
- Clarify painful motion, instability, flare-ups, stairs, kneeling, and work impact.

Important:
- Knee ratings often depend on limitation of flexion, limitation of extension, instability, and meniscal findings.
- Final ratings depend on the full record, exam findings, and adjudicator review.`;
}

function analyzeSleepApnea(t) {
  const cpap =
    hasAny(t, [
      "cpap",
      "bipap",
      "breathing assistance device",
      "uses cpap",
      "prescribed cpap"
    ]);

  const chronicFailure =
    hasAny(t, [
      "respiratory failure",
      "carbon dioxide retention",
      "cor pulmonale",
      "tracheostomy"
    ]);

  const persistentDaytime =
    hasAny(t, [
      "daytime hypersomnolence",
      "daytime sleepiness",
      "falls asleep during day",
      "excessive daytime sleepiness",
      "persistent daytime"
    ]);

  if (chronicFailure) {
    return `Condition: Sleep Apnea
Diagnostic Code: 6847
Estimated VA Rating: 100%

Reasoning:
- The statement suggests very severe sleep apnea criteria such as respiratory failure, cor pulmonale, or tracheostomy-level severity.
- The text supports the highest starter estimate.

Next Steps:
- Upload sleep study, pulmonary records, hospital records, DBQs, and respiratory specialist notes.
- Clarify respiratory complications and device or surgical history.

Important:
- Sleep apnea ratings turn heavily on sleep study findings and treatment requirements.
- Final ratings depend on the full record and adjudicator review.`;
  }

  if (cpap) {
    return `Condition: Sleep Apnea
Diagnostic Code: 6847
Estimated VA Rating: 50%

Reasoning:
- The statement indicates required use of a CPAP, BiPAP, or other breathing assistance device.
- That generally supports the standard 50 percent schedular level.

Next Steps:
- Upload sleep study, CPAP prescription, compliance records, DBQs, and treatment notes.
- Clarify when the device was prescribed and current use.

Important:
- Sleep apnea ratings turn heavily on sleep study findings and treatment requirements.
- Final ratings depend on the full record and adjudicator review.`;
  }

  if (persistentDaytime) {
    return `Condition: Sleep Apnea
Diagnostic Code: 6847
Estimated VA Rating: 30%

Reasoning:
- The statement suggests persistent daytime hypersomnolence without confirmed device criteria.
- That supports a 30 percent starter estimate.

Next Steps:
- Upload sleep study, treatment notes, DBQs, and lay statements.
- Clarify daytime sleepiness, snoring, witnessed apneas, and whether a device was prescribed.

Important:
- Sleep apnea ratings turn heavily on sleep study findings and treatment requirements.
- Final ratings depend on the full record and adjudicator review.`;
  }

  return `Condition: Sleep Apnea
Diagnostic Code: 6847
Estimated VA Rating: 0%

Reasoning:
- Sleep apnea may be suggested, but the text does not yet establish compensable schedular criteria.
- More detail is needed about testing, symptoms, and treatment.

Next Steps:
- Upload sleep study, treatment notes, DBQs, and lay statements.
- Clarify snoring, witnessed apneas, daytime sleepiness, and device requirements.

Important:
- Sleep apnea ratings turn heavily on sleep study findings and treatment requirements.
- Final ratings depend on the full record and adjudicator review.`;
}

function analyzeCfr38(raw) {
  const t = String(raw || "").toLowerCase();

  if (hasAny(t, ["migraine", "headache"])) {
    return analyzeMigraines(t);
  }

  if (
    hasAny(t, [
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
    ])
  ) {
    return analyzeMentalHealth(t);
  }

  if (hasAny(t, ["tinnitus", "ringing in ears", "ringing in ear", "ringing"])) {
    return analyzeTinnitus(t);
  }

  if (
    hasAny(t, [
      "lumbar",
      "lower back",
      "back pain",
      "thoracolumbar",
      "sciatica",
      "radiculopathy"
    ])
  ) {
    return analyzeLumbarBack(t);
  }

  if (
    hasAny(t, [
      "knee",
      "knees",
      "patella",
      "meniscus",
      "acl",
      "mcl"
    ])
  ) {
    return analyzeKnee(t);
  }

  if (
    hasAny(t, [
      "sleep apnea",
      "cpap",
      "bipap",
      "snoring",
      "witnessed apneas",
      "daytime hypersomnolence"
    ])
  ) {
    return analyzeSleepApnea(t);
  }

  return fallbackResult(raw);
}

module.exports = {
  analyzeCfr38,
  fallbackResult
};
