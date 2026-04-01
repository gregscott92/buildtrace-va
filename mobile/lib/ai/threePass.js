const OpenAI = require("openai");

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ----------------------------
// PASS 1 — CONTEXT PULL
// ----------------------------
async function pass1_context(input) {
  const res = await client.chat.completions.create({
    model: "gpt-5.3",
    messages: [
      {
        role: "system",
        content: "Extract intent, audience, and goal. Be concise.",
      },
      {
        role: "user",
        content: input,
      },
    ],
  });

  return res.choices[0].message.content;
}

// ----------------------------
// PASS 2 — DRAFT
// ----------------------------
async function pass2_draft(context) {
  const res = await client.chat.completions.create({
    model: "gpt-5.3",
    messages: [
      {
        role: "system",
        content:
          "Write a high-retention X (Twitter) post. Strong hook. No fluff. Direct.",
      },
      {
        role: "user",
        content: context,
      },
    ],
  });

  return res.choices[0].message.content;
}

// ----------------------------
// PASS 3 — TIGHTEN x3
// ----------------------------
async function pass3_tighten(draft) {
  const res = await client.chat.completions.create({
    model: "gpt-5.3",
    messages: [
      {
        role: "system",
        content:
          "Tighten this 3 times. Remove fluff. Increase clarity and punch. Keep under 280 chars.",
      },
      {
        role: "user",
        content: draft,
      },
    ],
  });

  return res.choices[0].message.content;
}

// ----------------------------
// MASTER FUNCTION
// ----------------------------
async function generateThreePass(input) {
  const context = await pass1_context(input);
  const draft = await pass2_draft(context);
  const final = await pass3_tighten(draft);

  return {
    context,
    draft,
    final,
  };
}

module.exports = { generateThreePass };