import { AuthenticationError, AuthorizationError } from "@/lib/http/errors";
import { requireVerifiedSubject, type VerifiedSubject } from "./server";


export async function requireOperationsAdmin(request: Request): Promise<VerifiedSubject> {
  const subject = await requireVerifiedSubject(request);
  if (process.env.REQUIRE_CF_ACCESS === "true" && !request.headers.get("CF-Access-Jwt-Assertion")) {
    throw new AuthorizationError("Cloudflare Access authentication is required for operations.");
  }
  const allowed = (process.env.ADMIN_PRIVY_SUBJECTS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  if (!allowed.includes(subject.subjectReference)) throw new AuthorizationError();
  return subject;
}

export { AuthenticationError, AuthorizationError };
