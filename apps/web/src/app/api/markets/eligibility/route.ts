import { env } from "cloudflare:workers";
import { AuthenticationError, requireVerifiedSubject } from "@/lib/auth/server";
import { BetaAccessError, requireBetaAccess } from "@/lib/beta/access";
import {
  evaluateRegulatedEligibility, type DocumentAcknowledgement, type InstrumentEligibilityPolicy
} from "@/lib/markets/eligibility";
import { createUnavailableEligibilityProvider, type EligibilityProvider } from "@/lib/markets/eligibility-provider";
import { getXstocksCatalogPage } from "@/lib/markets/xstocks";
import { enforceRateLimit, RateLimitError } from "@/lib/security/rate-limit";

type Dependencies = {
  authenticate: (request: Request) => Promise<{ subjectReference: string }>;
  requireAccess: (subjectReference: string) => Promise<unknown>;
  rateLimit: (subjectReference: string) => Promise<unknown>;
  resolvePolicy: (instrumentId: string) => Promise<InstrumentEligibilityPolicy | null>;
  provider: EligibilityProvider;
  acknowledgements: (subjectReference: string) => Promise<DocumentAcknowledgement[]>;
  now: () => number;
};

class EligibilityApiError extends Error {
  constructor(public readonly code: "invalid_request" | "instrument_not_found") { super(code); }
}

function parseRequest(request: Request): string {
  const params = new URL(request.url).searchParams;
  if ([...params.keys()].some((key) => key !== "instrumentId") || params.getAll("instrumentId").length !== 1) throw new EligibilityApiError("invalid_request");
  const instrumentId = params.get("instrumentId") ?? "";
  if (!/^xstocks:[A-Za-z0-9._:-]{1,160}$/.test(instrumentId)) throw new EligibilityApiError("invalid_request");
  return instrumentId;
}

export function createEligibilityHandler(dependencies: Dependencies) {
  return async function getEligibility(request: Request) {
    const traceId = crypto.randomUUID();
    try {
      const subject = await dependencies.authenticate(request);
      await dependencies.requireAccess(subject.subjectReference);
      await dependencies.rateLimit(subject.subjectReference);
      const instrumentId = parseRequest(request);
      const policy = await dependencies.resolvePolicy(instrumentId);
      if (!policy) throw new EligibilityApiError("instrument_not_found");
      const [providerDecision, acknowledgements] = await Promise.all([
        dependencies.provider.evaluate({ subjectReference: subject.subjectReference, instrumentId }),
        dependencies.acknowledgements(subject.subjectReference)
      ]);
      const result = evaluateRegulatedEligibility({ subjectReference: subject.subjectReference, instrumentId, policy, providerDecision, acknowledgements, now: dependencies.now() });
      return Response.json({ ...result, authority: "Contracted eligibility provider decision plus reviewed instrument policy; authentication and profile fields are not eligibility" }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      if (error instanceof AuthenticationError) return Response.json({ error: "unauthorized", traceId }, { status: 401, headers: { "Cache-Control": "no-store" } });
      if (error instanceof BetaAccessError) return Response.json({ error: error.code, traceId }, { status: 403, headers: { "Cache-Control": "no-store" } });
      if (error instanceof RateLimitError) return Response.json({ error: "rate_limited", traceId }, { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": String(error.retryAfterSeconds) } });
      if (error instanceof EligibilityApiError) return Response.json({ error: error.code, traceId }, { status: error.code === "instrument_not_found" ? 404 : 400, headers: { "Cache-Control": "no-store" } });
      console.error(JSON.stringify({ level: "error", event: "markets.eligibility.failed", traceId, message: error instanceof Error ? error.message : "unknown" }));
      return Response.json({ error: "eligibility_unavailable", traceId }, { status: 503, headers: { "Cache-Control": "no-store" } });
    }
  };
}

async function resolvePublicPolicy(instrumentId: string): Promise<InstrumentEligibilityPolicy | null> {
  const page = await getXstocksCatalogPage({ query: instrumentId });
  const instrument = page.instruments.find((item) => item.id === instrumentId);
  if (!instrument) return null;
  return {
    instrumentId, allowedCountries: instrument.countryPolicy.allowedCountries, blockedCountries: instrument.countryPolicy.blockedCountries,
    provenance: instrument.countryPolicy.provenance, reviewedAt: instrument.countryPolicy.reviewedAt,
    expiresAt: instrument.review.expiresAt, venue: null,
    requiredDocuments: instrument.documents.map((document) => ({ key: document.kind, version: document.version, effectiveAt: document.effectiveAt, expiresAt: instrument.review.expiresAt }))
  };
}

async function readAcknowledgements(subjectReference: string): Promise<DocumentAcknowledgement[]> {
  const result = await env.PROJECTION_DB.prepare(`SELECT document_key, document_version, accepted_at, consent_id
    FROM consent_evidence WHERE subject_reference = ? ORDER BY accepted_at DESC LIMIT 100`).bind(subjectReference).all<{
    document_key: string; document_version: string; accepted_at: string; consent_id: string;
  }>();
  return result.results.map((row) => ({ subjectReference, documentKey: row.document_key, documentVersion: row.document_version, acceptedAt: row.accepted_at, evidenceReference: row.consent_id }));
}

export const GET = createEligibilityHandler({
  authenticate: requireVerifiedSubject,
  requireAccess: (subjectReference) => requireBetaAccess(env.PROJECTION_DB, subjectReference),
  rateLimit: (subjectReference) => enforceRateLimit(env.PROJECTION_DB, { namespace: "markets_eligibility", subject: subjectReference, limit: 20, windowSeconds: 600 }),
  resolvePolicy: resolvePublicPolicy,
  provider: createUnavailableEligibilityProvider(), acknowledgements: readAcknowledgements, now: Date.now
});
