function fallbackResult(raw) {
  return `Condition: Unclassified Condition
Estimated VA Rating: 0%

Reasoning:
- The current engine did not confidently map this condition to a starter CFR rule pack.

Next Steps:
- State the exact claimed condition.
- Describe diagnosis, frequency, duration, severity, and functional/work impact.
- Upload medical records, DBQs, and service connection evidence.

Important:
- This engine currently uses starter rule packs and should be expanded body-system by body-system.`;
}

function analyzeCfr38(raw) {
  const t = String(raw || "").toLowerCase();

  // ============================
  // MIGRAINES / HEADACHES
  // DC 8100 (starter estimate)
  // ============================
  if (t.includes("migraine") || t.includes("headache")) {
    const monthly34 =
      t.includes("3 to 4 times per month") ||
      t.includes("3-4 times per month") ||
      t.includes("3 or 4 times per month") ||
      t.includes("three to four times per month") ||
      t.includes("3 times per month") ||
      t.includes("4 times per month");

    const monthly =
      monthly34 ||
      t.includes("monthly") ||
      t.includes("once a month") ||
      t.includes("1 time per month") ||
      t.includes("2 times per month") ||
      t.includes("per month");

    const prostrating =
      t.includes("lie down") ||
      t.includes("lay down") ||
      t.includes("dark room") ||
      t.includes("prostrating") ||
      t.includes("light sensitivity") ||
      t.includes("photophobia") ||
      t.includes("nausea");

    const severeImpact =
      t.includes("misses work") ||
      t.includes("missed work") ||
      t.includes("flare-ups") ||
      t.includes("unable to work") ||
      t.includes("call out") ||
      t.includes("call off") ||
      t.includes("reduced productivity");

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

  return fallbackResult(raw);
}

module.exports = {
  analyzeCfr38,
  fallbackResult
};
