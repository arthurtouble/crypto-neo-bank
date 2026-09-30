import { z } from "zod";
import { HttpError } from "./errors";

type RouteContext = { traceId: string };
type Options = {
  /** Error code for malformed input (Zod failures and request bodies `readJsonBody` couldn't parse). */
  invalid?: string;
  /** Error code for unexpected failures; the cause is logged with the trace ID. */
  unavailable: string;
  /** Status and customer message for unexpected failures (default 503, no message). */
  unavailableStatus?: number;
  unavailableMessage?: string;
  /** Map route-specific errors before the shared mapping runs. */
  onError?: (error: unknown, context: RouteContext) => Response | undefined;
};

const noStore = "no-store";

/** A JSON error response with the trace ID and a no-store default. */
export function errorResponse(status: number, code: string, context: RouteContext, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  return Response.json({ error: code, ...extra, traceId: context.traceId }, { status, headers: { "Cache-Control": noStore, ...headers } });
}

/** A request body that isn't JSON: the caller's mistake, answered 400 with the route's `invalid` code. */
class InvalidJsonBodyError extends HttpError {
  constructor() { super(400, "invalid", "The request body isn't valid JSON."); this.name = "InvalidJsonBodyError"; }
}

/**
 * The request body as JSON. Handlers read bodies with this, so only the
 * caller's malformed JSON is a 400; a provider answering with something that
 * isn't JSON stays an unexpected failure.
 */
export async function readJsonBody(request: Request): Promise<unknown> {
  try { return await request.json(); } catch { throw new InvalidJsonBodyError(); }
}

/**
 * Wrap an API handler: assign a trace ID, map known errors to safe responses,
 * log unexpected failures, and default every response to no-store.
 * Authentication, feature, and rate-limit checks stay explicit in the handler.
 */
export function route<Args extends unknown[]>(name: string, options: Options, handler: (request: Request, context: RouteContext, ...args: Args) => Promise<Response>) {
  return async (request: Request, ...args: Args): Promise<Response> => {
    const context: RouteContext = { traceId: crypto.randomUUID() };
    let response: Response;
    try {
      response = await handler(request, context, ...args);
    } catch (error) {
      response = options.onError?.(error, context) ?? toResponse(name, options, error, context);
    }
    if (!response.headers.has("Cache-Control")) {
      try { response.headers.set("Cache-Control", noStore); } catch { /* immutable response already carries its own policy */ }
    }
    return response;
  };
}

function toResponse(name: string, options: Options, error: unknown, context: RouteContext): Response {
  if (error instanceof InvalidJsonBodyError) return errorResponse(400, options.invalid ?? "invalid_request", context);
  if (error instanceof HttpError) return errorResponse(error.status, error.code, context, { message: error.message }, error.headers);
  if (error instanceof z.ZodError) return errorResponse(400, options.invalid ?? "invalid_request", context, { issues: error.issues });
  console.error(JSON.stringify({ level: "error", event: `${name}.failed`, traceId: context.traceId, message: error instanceof Error ? error.message : "unknown" }));
  return errorResponse(options.unavailableStatus ?? 503, options.unavailable, context, options.unavailableMessage ? { message: options.unavailableMessage } : {});
}
