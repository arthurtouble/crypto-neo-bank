import { env } from "cloudflare:workers";
import { z } from "zod";
import { requireVerifiedSubject } from "@/lib/auth/server";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { requireFeature } from "@/lib/features/flags";
import { route } from "@/lib/http/route";

const requestSchema = z.object({ question: z.string().trim().min(2).max(1200) });
const SYSTEM = `You are Aura Support, a concise financial product assistant. Explain product mechanics, wallet safety, liquidity, Aave risks, membership and provider roles in plain language. Never claim to know a balance not supplied in the prompt. Never give individualized investment, tax or legal advice. Never say an action has executed. You cannot move money, sign, approve, guarantee returns or override policy. If asked to transact, provide a draft checklist and say the customer must review deterministic policy results and confirm in Privy. Distinguish Aura, Privy, public blockchains, Aave and future Bridge responsibilities. Do not call Aura a bank and do not call DeFi positions deposits or savings.`;

export const POST = route("support.assistant.post", { unavailable: "assistant_unavailable", invalid: "invalid_question" }, async (request: Request, { traceId }) => {
  const subject = await requireVerifiedSubject(request);
  await requireFeature(env.PROJECTION_DB, "support_assistant");
  await enforceRateLimit(env.PROJECTION_DB, { namespace: "support_assistant", subject: subject.subjectReference, limit: 10, windowSeconds: 60 });
  const { question } = requestSchema.parse(await request.json());
  const result = await env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
    messages: [{ role: "system", content: SYSTEM }, { role: "user", content: question }],
    max_tokens: 650,
    temperature: 0.2
  });
  const response = typeof result === "object" && result && "response" in result ? String(result.response) : "The assistant could not produce a response.";
  return Response.json({ response, traceId, capabilities: "read-only-explanation-and-drafting" }, { headers: { "Cache-Control": "no-store" } });
});
