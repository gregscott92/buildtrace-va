const { analyzeCfr38 } = require("./lib/cfr38-engine");
const express = require("express");
const OpenAI = require("openai");

const openai =
  process.env.OPENAI_API_KEY
    ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    : null;

async function generateArenaAnswer(post) {
  if (!openai) return null;

  const topic = String(post?.topic || "").trim().toLowerCase();
  const body = String(post?.body || "").trim();
  const title = String(post?.title || "").trim();

  try {
    let systemPrompt = "";
    let userPrompt = `${title}

${body}`.trim();

    if (topic === "va") {
      systemPrompt = [
        "You are a VA disability claims evaluator.",
        "Return a concise but useful answer.",
        "Use this exact format:",
        "",
        "Likely VA Rating: <number or range>",
        "Service Connection: <Strong | Moderate | Weak>",
        "",
        "Why:",
        "<short reasoning>",
        "",
        "What You're Missing:",
        "<missing evidence or gaps>",
        "",
        "Next Steps:",
        "<clear actions>",
        "",
        "Rules:",
        "- Be direct.",
        "- Do not use fluff.",
        "- Do not give a generic disclaimer paragraph.",
        "- Keep each section tight and practical."
      ].join("\n");
    } else if (topic === "sports") {
      systemPrompt = [
        "You are replying in a sports debate forum.",
        "Sound like a sharp sports fan, not a chatbot.",
        "Be direct, opinionated, and concise.",
        "Answer in 2 to 4 sentences max. Keep it tight.",
        "Take a clear stance. Avoid neutral answers.",
        "Do not ask vague clarification questions unless the post is totally unusable.",
        "Do not mention being an AI.",
        "Do not sound formal or supportive.",
        "Avoid polished or essay-style writing. Write like a real person in a forum."
      ].join("\n");
    } else if (topic === "music") {
      systemPrompt = [
        "You are replying in a music discussion forum.",
        "Sound like someone with taste and conviction.",
        "Be concise, direct, and a little punchy.",
        "Answer in 2 to 4 sentences max. Keep it tight.",
        "Take a position.",
        "No chatbot filler.",
        "No generic hedging.",
        "Do not ask for clarification unless absolutely necessary.",
        "Avoid polished or essay-style writing. Write like a real person in a forum."
      ].join("\n");
    } else if (topic === "politics") {
      systemPrompt = [
        "You are replying in a politics discussion forum.",
        "Be direct and slightly blunt.",
        "Answer in 2 to 4 sentences max. Keep it tight.",
        "State the strongest case plainly.",
        "No generic neutrality language.",
        "No 'both sides' filler unless the post truly requires it.",
        "Do not sound like a customer support bot.",
        "Avoid polished or essay-style writing. Write like a real person in a forum."
      ].join("\n");
    } else {
      systemPrompt = [
        "You are replying in a public discussion forum.",
        "Be direct and concise.",
        "Answer in 2 to 5 sentences.",
        "No chatbot filler.",
        "Sound human."
      ].join("\n");
    }

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      temperature: 0.8,
      max_tokens: 120
    });

    return response?.choices?.[0]?.message?.content?.trim() || null;
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

  
  router.get("/topics", async (_req, res) => {
    try {
      const { data, error } = await supabase
        .from("arena_topics")
        .select("*")
        .eq("is_active", true)
        .order("sort_order", { ascending: true });

      if (error) throw error;

      return res.json({ success: true, topics: data || [] });
    } catch (err) {
      return res.status(400).json({
        success: false,
        error: err.message || "Failed to load topics",
      });
    }
  });

router.get("/posts", async (req, res) => {
    try {
      const topic = String(req.query.topic || "va").trim().toLowerCase();

      const { data: posts, error: postsError } = await supabase
        .from("arena_posts")
        .select("*")
        .eq("topic", topic)
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
      const { title, body = "", topic = "va" } = req.body || {};

      if (!title || !String(title).trim()) {
        return res.status(400).json({
          success: false,
          error: "title is required",
        });
      }

      const { data: post, error: postError } = await supabase
        .from("arena_posts")
        .insert([{ title: String(title).trim(), body, topic: String(topic || "va").trim().toLowerCase() }])
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


  router.get("/featured", async (_req, res) => {
    try {
      const topic = String(req.query.topic || "va").trim().toLowerCase();

      const { data: posts, error: postsError } = await supabase
        .from("arena_posts")
        .select("*")
        .eq("topic", topic)
        .order("created_at", { ascending: false });

      if (postsError) throw postsError;

      const postIds = (posts || []).map((p) => p.id);

      let answers = [];
      let comments = [];

      if (postIds.length) {
        const { data: answerRows, error: answersError } = await supabase
          .from("arena_answers")
          .select("*")
          .in("post_id", postIds)
          .order("created_at", { ascending: true });

        if (answersError) throw answersError;
        answers = answerRows || [];

        const { data: commentRows, error: commentsError } = await supabase
          .from("arena_comments")
          .select("*")
          .in("post_id", postIds)
          .order("created_at", { ascending: true });

        if (commentsError) throw commentsError;
        comments = commentRows || [];
      }

      const byPostAnswers = {};
      for (const a of answers) {
        if (!byPostAnswers[a.post_id]) byPostAnswers[a.post_id] = [];
        byPostAnswers[a.post_id].push(a);
      }

      const byPostComments = {};
      for (const c of comments) {
        if (!byPostComments[c.post_id]) byPostComments[c.post_id] = [];
        byPostComments[c.post_id].push(c);
      }

      const merged = (posts || []).map((p) => ({
        ...p,
        answers: byPostAnswers[p.id] || [],
        comments: byPostComments[p.id] || [],
        engagement_score: (byPostAnswers[p.id] || []).length + (byPostComments[p.id] || []).length,
      }));

      merged.sort((a, b) => {
        if (b.engagement_score !== a.engagement_score) return b.engagement_score - a.engagement_score;
        return new Date(b.created_at) - new Date(a.created_at);
      });

      return res.json({
        success: true,
        post: merged[0] || null,
      });
    } catch (err) {
      return res.status(400).json({
        success: false,
        error: err.message || "Failed to fetch featured post",
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

  

  // ============================
  // COMMENTS
  // ============================

  router.post("/comments", async (req, res) => {
    try {
      const { post_id, body } = req.body || {};

      if (!post_id) {
        return res.status(400).json({ success: false, error: "post_id required" });
      }

      if (!body || !body.trim()) {
        return res.status(400).json({ success: false, error: "body required" });
      }

      const { data, error } = await supabase
        .from("arena_comments")
        .insert([{ post_id, body: body.trim() }])
        .select()
        .single();

      if (error) throw error;

      return res.json({ success: true, comment: data });

    } catch (err) {
      return res.status(400).json({ success: false, error: err.message });
    }
  });

  router.get("/comments/:post_id", async (req, res) => {
    try {
      const { post_id } = req.params;

      const { data, error } = await supabase
        .from("arena_comments")
        .select("*")
        .eq("post_id", post_id)
        .order("created_at", { ascending: true });

      if (error) throw error;

      return res.json({ success: true, comments: data || [] });

    } catch (err) {
      return res.status(400).json({ success: false, error: err.message });
    }
  });

  return router;
};
