import { createSttCheckHandler } from "@/lib/stt-api";

export const runtime = "nodejs";

export const POST = createSttCheckHandler({
  fetchImpl: fetch,
  now: () => performance.now(),
  getConfig: () => ({
    apiKey: process.env.SPEKO_API_KEY,
    apiBaseUrl: process.env.SPEKO_API_BASE ?? "https://api.speko.dev",
  }),
});
