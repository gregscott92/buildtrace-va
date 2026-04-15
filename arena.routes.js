const { analyzeCfr38 } = require("./lib/cfr38-engine");
const express = require("express");
const OpenAI = require("openai");

const openai =
  process.env.OPENAI_API_KEY
    ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    : null;

async function generateArenaAnswer(post) {
  if (!openai) {
    return null;
  }

  try {

    const response = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content: [
            "You are a VA disability claims evaluator.",
            "",
            "Return EXACT format:",
            "",
            "Likely VA Rating: <number or range>",
            "Service Connection: <Strong | Moderate | Weak>",
            "",
            "Why:",
            "<reasoning>",
            "",
            "What You're Missing:",
            "<missing evidence>",
            "",
            "Next Steps:",
            "<actions>",
            "",
            "Rules:",
            "- Never return Unknown%",
            "- Always give a best estimate",
            "- Fill all sections"
          ].join("\n")
        },
        {
          role: "user",
          content: post.body || ""
        }
      ]
    });

    const text = response?.choices?.[0]?.message?.content || "";

    return text || null;
  } catch (err) {
    return null;
  }
}

function isVAClaim(text) {
  const t = (text || "").toLowerCase();

  // HARD MATCH (military/service context required)
  const hasService = t.includes("service") || t.includes("military");

  // CONDITION KEYWORDS
  const hasCondition = [
    "migraine",
    "ptsd",
    "tinnitus",
    "back pain",
    "sleep apnea",
    "anxiety",
    "depression",
    "injury"
  ].some(k => t.includes(k));

  return hasCondition && (
  hasService ||
  t.includes("deployment") ||
  t.includes("afghanistan") ||
  t.includes("iraq") ||
  t.includes("combat")
);
}

module.exports = function createArenaRouter(supabase) {
  const router = express.Router();

  router.get("/posts", async (_req, res) => {
    try {
      const { data: posts, error: postsError } = await supabase
        .from("arena_posts")
        .select("*")
        .order("created_at", { ascending: false });

      if (postsError) throw postsError;

      const postIds = (posts || []).map((p) => p.id);

      let answers = [];
      if (postIds.length) {
        const { data: answerRows, error: answersError } = await supabase
          .from("arena_answers")
          .select("*")
          .in("post_id", postIds)
          .order("created_at", { ascending: true });

        if (answersError) throw answersError;
        answers = answerRows || [];
      }

      const byPost = {};
      for (const a of answers) {
        if (!byPost[a.post_id]) byPost[a.post_id] = [];
        byPost[a.post_id].push(a);
      }

      const merged = (posts || []).map((p) => ({
        ...p,
        answers: byPost[p.id] || [],
      }));

      return res.json({ success: true, posts: merged });
    } catch (err) {
      return res.status(400).json({
        success: false,
        error: err.message || "Failed to fetch posts",
      });
    }
  });

  router.post("/posts", async (req, res) => {
    try {
      const { title, body = "" } = req.body || {};

      if (!title || !String(title).trim()) {
        return res.status(400).json({
          success: false,
          error: "title is required",
        });
      }

      const { data: post, error: postError } = await supabase
        .from("arena_posts")
        .insert([{ title: String(title).trim(), body }])
        .select()
        .single();

      if (postError) throw postError;

      let aiAnswer = null;

      try {
        let generated = null;

if (isVAClaim((post.title || "") + " " + (post.body || ""))) {
  console.log("VA CLAIM DETECTED");

  try {
    const input = (post.title || "") + " " + (post.body || "");
const analysis = await analyzeCfr38(input);

generated = analysis || "VA analysis unavailable";
  } catch (e) {
    console.log("VA analyzer failed:", e.message);
    generated = "VA analysis error.";
  }

} else {
  console.log("FALLBACK AI USED");
  if (!generated) {
  generated = await generateArenaAnswer(post);
}
}

        if (generated) {
          const { data: answer, error: answerError } = await supabase
            .from("arena_answers")
            .insert([{
              post_id: post.id,
              reasoning: generated,
              used_ai: true,
            }])
            .select()
            .single();

          if (!answerError) {
            aiAnswer = answer;
          }
        }
      } catch (_err) {
        // fail open: post still succeeds even if AI answer generation fails
      }

      return res.json({
        success: true,
        post,
        ai_answer: aiAnswer,
      });
    } catch (err) {
      return res.status(400).json({
        success: false,
        error: err.message || "Failed to create post",
      });
    }
  });

  router.post("/answers", async (req, res) => {
    try {
      const { post_id, reasoning, used_ai = false } = req.body || {};

      if (!post_id) {
        return res.status(400).json({
          success: false,
          error: "post_id is required",
        });
      }

      if (!reasoning || !String(reasoning).trim()) {
        return res.status(400).json({
          success: false,
          error: "reasoning is required",
        });
      }

      const { data, error } = await supabase
        .from("arena_answers")
        .insert([{
          post_id,
          reasoning: String(reasoning).trim(),
          used_ai: Boolean(used_ai),
        }])
        .select()
        .single();

      if (error) throw error;

      return res.json({ success: true, answer: data });
    } catch (err) {
      return res.status(400).json({
        success: false,
        error: err.message || "Failed to create answer",
      });
    }
  });

  router.post("/stake", async (req, res) => {
    try {
      const { user_id, answer_id, amount } = req.body || {};

      if (!user_id || !answer_id || !amount) {
        return res.status(400).json({
          success: false,
          error: "user_id, answer_id, and amount are required",
        });
      }

      const { error } = await supabase.rpc("arena_place_stake", {
        p_user_id: user_id,
        p_answer_id: answer_id,
        p_amount: amount,
      });

      if (error) throw error;

      return res.json({ success: true });
    } catch (err) {
      return res.status(400).json({
        success: false,
        error: err.message || "Failed to place stake",
      });
    }
  });

  return router;
};
