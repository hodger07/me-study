import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    const { userId } = req.query;
    if (!userId || typeof userId !== "string" || !/^[a-z0-9]+$/i.test(userId)) {
      return res.status(400).json({ error: "Invalid userId" });
    }
    const data = await redis.get(`user:${userId}`);
    if (!data) {
      return res.status(200).json({ progress: null });
    }
    const progress = typeof data === "string" ? JSON.parse(data) : data;
    return res.status(200).json({ progress });
  } catch (e) {
    console.error("load-progress error:", e);
    return res.status(500).json({ error: "Internal error" });
  }
}
