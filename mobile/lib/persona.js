// lib/persona.js

function normalizeWhitespace(text = "") {
  return String(text)
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function splitSentences(text = "") {
  return String(text)
    .replace(/\n/g, " ")
    .match(/[^.!?]+[.!?]?/g)?.map((s) => s.trim()).filter(Boolean) || [];
}

function trimSentenceLength(text = "", maxSentenceLength = 220) {
  const sentences = splitSentences(text);

  const trimmed = sentences.map((sentence) => {
    if (sentence.length <= maxSentenceLength) return sentence;

    const words = sentence.split(/\s+/);
    let out = "";

    for (const word of words) {
      if ((out + " " + word).trim().length > maxSentenceLength - 3) {
        return out.trim() + "...";
      }
      out = (out + " " + word).trim();
    }

    return out.trim();
  });

  return trimmed.join(" ");
}

function removeCorporateFiller(text = "") {
  let out = String(text);

  const replacements = [
    [/\bleverage\b/gi, "use"],
    [/\butilize\b/gi, "use"],
    [/\bsynergy\b/gi, "alignment"],
    [/\bgame[- ]changer\b/gi, "strong move"],
    [/\bthought leadership\b/gi, "point of view"],
    [/\bin today'?s fast-paced world\b/gi, ""],
    [/\bat the end of the day\b/gi, ""],
    [/\bit'?s important to note that\b/gi, ""],
    [/\bone thing is clear\b/gi, ""],
    [/\bin conclusion[:,]?\b/gi, ""],
    [/\bI am excited to share\b/gi, "Here’s something worth sharing"],
    [/\bI’m excited to share\b/gi, "Here’s something worth sharing"],
    [/\bthis means that\b/gi, "This means"],
    [/\bvery unique\b/gi, "distinct"],
    [/\btruly\b/gi, ""],
    [/\breally\b/gi, ""],
    [/\bactually\b/gi, ""],
    [/\bjust\b/gi, ""]
  ];

  for (const [pattern, replacement] of replacements) {
    out = out.replace(pattern, replacement);
  }

  return normalizeWhitespace(out);
}

function removeWeakOpeners(text = "") {
  const lines = String(text).split("\n").filter(Boolean);

  if (!lines.length) return "";

  const weakOpeners = [
    /^here'?s something worth sharing[:\-\s]*/i,
    /^i want to talk about[:\-\s]*/i,
    /^let'?s talk about[:\-\s]*/i,
    /^it'?s important to understand[:\-\s]*/i,
    /^one thing i'?ve learned[:\-\s]*/i,
    /^today i want to share[:\-\s]*/i
  ];

  lines[0] = lines[0].trim();
  for (const pattern of weakOpeners) {
    lines[0] = lines[0].replace(pattern, "").trim();
  }

  return normalizeWhitespace(lines.join("\n"));
}

function varySentenceTexture(text = "", textureStrength = 0.2) {
  const sentences = splitSentences(text);
  if (!sentences.length) return text;

  const out = [];

  for (let i = 0; i < sentences.length; i++) {
    let sentence = sentences[i];

    if (textureStrength >= 0.25 && i > 0) {
      sentence = sentence
        .replace(/^However,\s*/i, "But ")
        .replace(/^Additionally,\s*/i, "Also ")
        .replace(/^Furthermore,\s*/i, "And ")
        .replace(/^Therefore,\s*/i, "So ");
    }

    out.push(sentence);
  }

  return normalizeWhitespace(out.join(" "));
}

function humanizeOutput(text = "", options = {}) {
  const {
    textureStrength = 0.2,
    maxSentenceLength = 220
  } = options;

  let out = String(text || "");

  out = normalizeWhitespace(out);
  out = removeCorporateFiller(out);
  out = removeWeakOpeners(out);
  out = varySentenceTexture(out, textureStrength);
  out = trimSentenceLength(out, maxSentenceLength);
  out = normalizeWhitespace(out);

  return out;
}

function applyOperatorPersona(text = "") {
  let out = String(text || "").trim();

  out = out
    .replace(/\btransform\b/gi, "improve")
    .replace(/\boptimize\b/gi, "tighten")
    .replace(/\bworld-class\b/gi, "solid")
    .replace(/\bseamless\b/gi, "clean")
    .replace(/\bpowerful\b/gi, "useful");

  return normalizeWhitespace(out);
}

function applyBuilderPersona(text = "") {
  let out = String(text || "").trim();

  if (!out) return out;

  out = out
    .replace(/\bproblem\b/gi, "build problem")
    .replace(/\btool\b/gi, "system")
    .replace(/\bapp\b/gi, "product");

  if (!/[.!?]$/.test(out)) out += ".";

  return normalizeWhitespace(out);
}

function applyAggressivePersona(text = "") {
  let out = String(text || "").trim();

  out = out
    .replace(/\bI think\b/gi, "")
    .replace(/\bmaybe\b/gi, "")
    .replace(/\bcan help\b/gi, "helps")
    .replace(/\bcould help\b/gi, "helps")
    .replace(/\btries to\b/gi, "")
    .replace(/\bis designed to\b/gi, "")
    .replace(/\bthere is\b/gi, "")
    .replace(/\bthere are\b/gi, "");

  const lines = out.split("\n").map((line) => line.trim()).filter(Boolean);

  if (lines.length > 0 && !/[.!?]$/.test(lines[0])) {
    lines[0] += ".";
  }

  return normalizeWhitespace(lines.join("\n"));
}

function applyPersona(text = "", persona = "operator") {
  const clean = String(text || "").trim();

  if (!clean) return clean;

  switch (persona) {
    case "builder":
      return applyBuilderPersona(clean);
    case "aggressive":
      return applyAggressivePersona(clean);
    case "operator":
    default:
      return applyOperatorPersona(clean);
  }
}

function choosePersona({ platform = "twitter", goal = "default" } = {}) {
  if (goal === "engagement") return "aggressive";
  if (goal === "thought_leadership") return "builder";
  if (goal === "build_log") return "operator";
  if (goal === "launch") return platform === "linkedin" ? "builder" : "aggressive";
  if (platform === "linkedin") return "builder";
  return "operator";
}

function finalizePost(text = "", options = {}) {
  const persona = options.persona || "operator";
  const postMode = options.postMode || "build_log";

  const humanizedText = humanizeOutput(text, {
    textureStrength: persona === "operator" ? 0.15 : 0.3,
    maxSentenceLength: 220
  });

  const finalText = applyPersona(humanizedText, persona);

  return {
    finalText,
    persona,
    postMode,
    humanized: true,
    generatedAt: new Date().toISOString()
  };
}

module.exports = {
  humanizeOutput,
  applyPersona,
  choosePersona,
  finalizePost
};