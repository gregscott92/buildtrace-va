function safeNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function vaCombineRatings(ratings = []) {
  const clean = ratings
    .map((r) => safeNumber(r))
    .filter((r) => r > 0)
    .sort((a, b) => b - a);

  let remainingEfficiency = 100;
  let combined = 0;
  const steps = [];

  for (const rating of clean) {
    const loss = remainingEfficiency * (rating / 100);
    combined += loss;
    remainingEfficiency -= loss;

    steps.push({
      rating,
      loss: Number(loss.toFixed(2)),
      combinedRaw: Number(combined.toFixed(2)),
      remainingEfficiency: Number(remainingEfficiency.toFixed(2)),
    });
  }

  const roundedToTen = Math.round(combined / 10) * 10;

  return {
    ratings: clean,
    combinedRaw: Number(combined.toFixed(2)),
    roundedCombined: roundedToTen,
    steps,
  };
}

function estimateCrsc({
  yearsOfService = 0,
  retiredPayMonthly = 0,
  vaCombinedRating = 0,
  combatRelatedPercent = 0,
}) {
  const yos = safeNumber(yearsOfService);
  const retiredPay = safeNumber(retiredPayMonthly);
  const vaRating = safeNumber(vaCombinedRating);
  const combatPercent = safeNumber(combatRelatedPercent);

  const serviceMultiplier = yos * 0.025;
  const longevityPortion = retiredPay * serviceMultiplier;
  const combatPortion = retiredPay * (combatPercent / 100);
  const estimatedMonthlyCrsc = Math.max(
    0,
    Math.min(longevityPortion, combatPortion, retiredPay)
  );

  return {
    inputs: {
      yearsOfService: yos,
      retiredPayMonthly: retiredPay,
      vaCombinedRating: vaRating,
      combatRelatedPercent: combatPercent,
    },
    serviceMultiplier: Number(serviceMultiplier.toFixed(4)),
    longevityPortion: Number(longevityPortion.toFixed(2)),
    combatPortion: Number(combatPortion.toFixed(2)),
    estimatedMonthlyCrsc: Number(estimatedMonthlyCrsc.toFixed(2)),
    note:
      "This is an estimate only. Final CRSC depends on branch review, approved combat-related conditions, and official retired pay calculations.",
  };
}

function buildVaOutcomePrompt(entryText, entryMeta = {}) {
  return `
You are helping analyze a VA claim note.

Rules:
- do not guarantee an award
- do not pretend to be the VA
- be careful and plain-English
- identify strengths, weaknesses, and missing evidence
- estimate only a likely rating range if enough info exists
- if not enough info exists, say that clearly

Return EXACTLY in this format:

=== SUMMARY ===
Short plain-English summary.

=== LIKELY RATING RANGE ===
A cautious estimated range, or "Not enough information".

=== STRENGTHS ===
Bullet list.

=== WEAKNESSES ===
Bullet list.

=== NEXT STEPS ===
Bullet list.

ENTRY META:
${JSON.stringify(entryMeta, null, 2)}

ENTRY TEXT:
${entryText}
`;
}

function extractSection(text, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(
    `=== ${escaped} ===\\s*([\\s\\S]*?)(?=\\n=== [A-Z ]+ ===|$)`,
    "m"
  );
  const match = String(text || "").match(regex);
  return match ? match[1].trim() : "";
}

module.exports = {
  vaCombineRatings,
  estimateCrsc,
  buildVaOutcomePrompt,
  extractSection,
};
