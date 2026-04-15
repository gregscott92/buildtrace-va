const express = require("express");

module.exports = function createArenaRouter(supabase) {
  const router = express.Router();

  router.get("/posts", async (_req, res) => {
    try {
      const { data, error } = await supabase
        .from("arena_posts")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;

      return res.json({ success: true, posts: data || [] });
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

      const { data, error } = await supabase
        .from("arena_posts")
        .insert([{ title: String(title).trim(), body }])
        .select()
        .single();

      if (error) throw error;

      return res.json({ success: true, post: data });
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
