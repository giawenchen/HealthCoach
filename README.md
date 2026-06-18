# 食记 · 营养健身管家

AI 营养与健身记录应用：自然语言/拍照记录饮食与运动，自动估算热量与营养，日历可视化热量缺口。

- 对话/估算：Claude
- 图片识别：Gemini
- 登录与同步：Supabase（邮箱魔法链接登录 + Postgres）
- 托管：Vercel（静态前端 + `api/` 无服务器函数代理）

## 目录

- `index.html` — 生产版入口（登录 + 云端同步）
- `fitness_coach.jsx` — 应用主体（浏览器内 Babel 编译）
- `api/llm-proxy.js` — 后端代理：藏 API key、校验登录、每日限流、转发 Claude/Gemini
- `api/config.js` — 把 Supabase 公开配置交给前端
- `supabase/rate_limit.sql` — 限流用的数据库函数
- `preview/` — 本地开发预览（`python3 preview/serve.py`）

## 部署需要的环境变量（在 Vercel 设置）

| 变量 | 说明 |
|---|---|
| `ANTHROPIC_API_KEY` | Claude key（sk-ant-...） |
| `GEMINI_API_KEY` | Gemini key |
| `SUPABASE_URL` | Supabase 项目 URL |
| `SUPABASE_ANON_KEY` | Supabase anon 公钥 |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service_role 私钥（仅后端用） |
| `USER_DAILY_LIMIT` | 每人每日 AI 次数上限（默认 30） |
| `GLOBAL_DAILY_LIMIT` | 全局每日上限（默认 300） |
