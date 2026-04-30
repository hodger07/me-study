import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    const { userId, progress } = req.body || {};
    if (!userId || typeof userId !== "string" || userId.length < 4 || userId.length > 32) {
      return res.status(400).json({ error: "Invalid userId" });
    }
    if (!/^[a-z0-9]+$/i.test(userId)) {
      return res.status(400).json({ error: "Invalid userId format" });
    }
    if (!progress || typeof progress !== "object") {
      return res.status(400).json({ error: "Invalid progress payload" });
    }
    const payload = JSON.stringify(progress);
    if (payload.length > 100000) {
      return res.status(413).json({ error: "Payload too large" });
    }
    await redis.set(`user:${userId}`, payload);
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("save-progress error:", e);
    return res.status(500).json({ error: "Internal error" });
  }
}
