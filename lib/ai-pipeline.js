// lib/ai-pipeline.js

const OpenAI = require("openai");
const { finalizePost, choosePersona } = require("./persona");

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

async function pass1Context(input) {
  const res = await client.chat.completions.create({
    model: process.env.OPENAI_MODEL || "gpt-4o",
    messages: [
      {
        role: "system",
        content:
          [
            "Extract the writing brief.",
            "Return concise structured text with these sections only:",
            "AUDIENCE:",
            "INTENT:",
            "PROOF_POINTS:",
            "STRONGEST_ANGLE:",
            "CONSTRAINTS:",
            "Keep it tight and operational."
          ].join("\n")
      },
      {
        role: "user",
        content: input
      }
    ]
  });

  return res.choices[0].message.content.trim();
}

async function pass2Draft(context) {
  const res = await client.chat.completions.create({
    model: process.env.OPENAI_MODEL || "gpt-4o",
    messages: [
      {
        role: "system",
        content:
          [
            "You are drafting social content from a structured brief.",
            "Write four labeled sections only:",
            "LINKEDIN:",
            "TWITTER:",
            "SLACK:",
            "SUMMARY:",
            "",
            "Rules:",
            "- Concrete language",
            "- No vague filler",
            "- No polished founder-speak",
            "- No corporate buzzwords",
            "- Make it usable"
          ].join("\n")
      },
      {
        role: "user",
        content: context
      }
    ]
  });

  return res.choices[0].message.content.trim();
}

async function pass3Tighten(draft) {
  const res = await client.chat.completions.create({
    model: process.env.OPENAI_MODEL || "gpt-4o",
    messages: [
      {
        role: "system",
        content:
          [
            "Tighten the draft.",
            "Keep the same four labels:",
            "LINKEDIN:",
            "TWITTER:",
            "SLACK:",
            "SUMMARY:",
            "",
            "Rules:",
            "- Remove weak openers",
            "- Remove repeated sentence structure",
            "- Remove filler and abstractions",
            "- Keep it human",
            "- Keep it sharp"
          ].join("\n")
      },
      {
        role: "user",
        content: draft
      }
    ]
  });

  return res.choices[0].message.content.trim();
}

function extractLabeledSection(text, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`${escaped}:\\s*([\\s\\S]*?)(?=\\n[A-Z_ ]+:|$)`, "i");
  const match = String(text || "").match(regex);
  return match ? match[1].trim() : "";
}

function parseDraftSections(text = "") {
  return {
    linkedin: extractLabeledSection(text, "LINKEDIN"),
    twitter: extractLabeledSection(text, "TWITTER"),
    slack: extractLabeledSection(text, "SLACK"),
    summary: extractLabeledSection(text, "SUMMARY")
  };
}

async function runFivePassPipeline(input, options = {}) {
  const {
    linkedinGoal = "thought_leadership",
    twitterGoal = "engagement",
    slackGoal = "build_log"
  } = options;

  const context = await pass1Context(input);
  const draft = await pass2Draft(context);
  const tightened = await pass3Tighten(draft);

  const sections = parseDraftSections(tightened);

  const linkedinPersona = choosePersona({
    platform: "linkedin",
    goal: linkedinGoal
  });

  const twitterPersona = choosePersona({
    platform: "twitter",
    goal: twitterGoal
  });

  const slackPersona = choosePersona({
    platform: "slack",
    goal: slackGoal
  });

  const linkedinFinal = finalizePost(sections.linkedin, {
    persona: linkedinPersona,
    postMode: linkedinGoal
  });

  const twitterFinal = finalizePost(sections.twitter, {
    persona: twitterPersona,
    postMode: twitterGoal
  });

  const slackFinal = finalizePost(sections.slack, {
    persona: slackPersona,
    postMode: slackGoal
  });

  return {
    raw: {
      context,
      draft,
      tightened
    },
    outputs: {
      linkedin: linkedinFinal,
      twitter: twitterFinal,
      slack: slackFinal,
      summary: sections.summary
    }
  };
}

module.exports = {
  pass1Context,
  pass2Draft,
  pass3Tighten,
  parseDraftSections,
  runFivePassPipeline
};