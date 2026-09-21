import { env } from "cloudflare:workers";
import { z } from "zod";
import { AuthenticationError, requireVerifiedSubject } from "@/lib/auth/server";

const requestSchema = z.object({ question: z.string().trim().min(2).max(1200) });
const SYSTEM = `You are Aurel Concierge, a concise private digital wealth product guide. Explain product mechanics, wallet safety, liquidity, Aave risks, membership and provider roles in plain language. Never claim to know a balance not supplied in the prompt. Never give individualized investment, tax or legal advice. Never say an action has executed. You cannot move money, sign, approve, guarantee returns or override policy. If asked to transact, provide a draft checklist and say the customer must review deterministic policy results and confirm in Privy. Distinguish Aurel, Privy, public blockchains, Aave and future Bridge responsibilities. Do not call Aurel a bank and do not call DeFi positions deposits or savings.`;

export async function POST(request: Request) {
  const traceId = crypto.randomUUID();
  try {
    await requireVerifiedSubject(request);
    const { question } = requestSchema.parse(await request.json());
    const result = await env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
      messages: [{ role: "system", content: SYSTEM }, { role: "user", content: question }],
      max_tokens: 650,
      temperature: 0.2
    });
    const response = typeof result === "object" && result && "response" in result ? String(result.response) : "The concierge could not produce a response.";
    return Response.json({ response, traceId, capabilities: "read-only-explanation-and-drafting" }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AuthenticationError) return Response.json({ error: "unauthorized", traceId }, { status: 401 });
    if (error instanceof z.ZodError) return Response.json({ error: "invalid_question", traceId }, { status: 400 });
    console.error(JSON.stringify({ level: "error", event: "concierge.failed", traceId, message: error instanceof Error ? error.message : "unknown" }));
    return Response.json({ error: "concierge_unavailable", message: "The concierge is temporarily unavailable.", traceId }, { status: 503 });
  }
}

