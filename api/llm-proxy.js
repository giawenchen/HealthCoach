// Vercel 无服务器函数：藏住 Claude/Gemini key + 校验登录 + 每日限流 + 转发上游
// 前端只带 Supabase 登录令牌调用本接口，永远拿不到真正的 API key。

const ANTHROPIC_MODEL = "claude-sonnet-4-5-20250929";
const GEMINI_MODEL = "gemini-2.5-flash";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "authorization, content-type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: { message: "method not allowed" } });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const ANON = process.env.SUPABASE_ANON_KEY;
  const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  const GEMINI_KEY = process.env.GEMINI_API_KEY;
  const USER_MAX = parseInt(process.env.USER_DAILY_LIMIT || "30", 10);
  const GLOBAL_MAX = parseInt(process.env.GLOBAL_DAILY_LIMIT || "300", 10);

  if (!SUPABASE_URL || !ANON || !SERVICE) {
    return res.status(500).json({ error: { message: "服务端未配置 Supabase 环境变量" } });
  }

  // 1) 校验登录令牌
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return res.status(401).json({ error: { message: "未登录" } });
  let uid = null;
  try {
    const u = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: ANON, Authorization: `Bearer ${token}` },
    });
    if (!u.ok) return res.status(401).json({ error: { message: "登录已失效，请重新登录" } });
    const user = await u.json();
    uid = user && user.id;
  } catch (e) {
    return res.status(401).json({ error: { message: "鉴权失败" } });
  }
  if (!uid) return res.status(401).json({ error: { message: "无效用户" } });

  // 2) 每日限流（原子检查+计数，service_role 调用 RPC）
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/check_and_count`, {
      method: "POST",
      headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_user: uid, p_user_max: USER_MAX, p_global_max: GLOBAL_MAX }),
    });
    const rl = await r.json();
    if (!rl || rl.allowed !== true) {
      const msg = rl && rl.reason === "global_limit"
        ? "今天大家用得有点多，已达每日总上限啦，明天再来～"
        : `你今天的 AI 次数已用完（每天 ${USER_MAX} 次），明天会自动恢复`;
      return res.status(429).json({ error: { message: msg } });
    }
  } catch (e) {
    return res.status(500).json({ error: { message: "限流检查失败，请稍后再试" } });
  }

  // 3) 解析请求体
  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  const task = body.task || "text";
  const maxTokens = Math.min(parseInt(body.max_tokens || 2000, 10) || 2000, 4000);

  try {
    if (task === "vision") {
      if (!GEMINI_KEY) return res.status(500).json({ error: { message: "服务端未配置 Gemini key" } });
      const parts = [
        ...(body.images || []).map((im) => ({ inline_data: { mime_type: im.media_type || "image/jpeg", data: im.data } })),
        { text: body.prompt || "" },
      ];
      const g = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_KEY },
        body: JSON.stringify({ contents: [{ parts }], generationConfig: { maxOutputTokens: maxTokens, temperature: 0.2 } }),
      });
      const gj = await g.json();
      if (!g.ok) return res.status(g.status).json({ error: { message: gj.error?.message || "Gemini 调用失败" } });
      const cand = (gj.candidates || [])[0];
      const text = (cand?.content?.parts || []).map((p) => p.text || "").join("");
      return res.status(200).json({ text });
    }

    if (!ANTHROPIC_KEY) return res.status(500).json({ error: { message: "服务端未配置 Anthropic key" } });
    const messages = body.messages || [];
    const userContent = (messages[0] && messages[0].content) || body.prompt || "";
    const a = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: ANTHROPIC_MODEL, max_tokens: maxTokens, messages: [{ role: "user", content: userContent }] }),
    });
    const aj = await a.json();
    if (!a.ok) return res.status(a.status).json({ error: { message: aj.error?.message || "Anthropic 调用失败" } });
    const text = (aj.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
    return res.status(200).json({ text });
  } catch (e) {
    return res.status(502).json({ error: { message: `上游调用失败：${e.message}` } });
  }
}
