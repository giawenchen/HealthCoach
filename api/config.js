// 把 Supabase 的「公开」配置交给前端（anon key 本就是给浏览器用的，靠行级权限保护数据）
export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({
    supabaseUrl: process.env.SUPABASE_URL || "",
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || "",
  });
}
