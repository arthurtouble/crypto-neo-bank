import { env } from "cloudflare:workers";
import { z } from "zod";
import { prepareBuiltAction } from "@/lib/actions/prepare";
import { requireProviderPlace } from "@/lib/legal/places";
import { readJsonBody, route } from "@/lib/http/route";
import { buildPerpsDeposit } from "@/lib/markets/deposits";
import { marketActor } from "@/lib/markets/guard";
import { venueErrorResponse } from "@/lib/markets/http";
import { actionView } from "../../actions/view";

const schema = z.strictObject({ amount: z.string().regex(/^\d+(\.\d{1,6})?$/).max(24) });

/** Prepare moving Base USDC into the customer's Hyperliquid perps balance, as an action they sign like any other. */
export const POST = route("perps.deposit", { invalid: "invalid_amount", unavailable: "perps_unavailable", onError: venueErrorResponse },
  async (request, { traceId }) => {
    const { subject, account } = await marketActor(env.PROJECTION_DB, request, "perps", 10);
    requireProviderPlace(request, "perps");
    const { amount } = schema.parse(await readJsonBody(request));
    const built = await buildPerpsDeposit(account.address, amount);
    const prepared = await prepareBuiltAction(env.PROJECTION_DB, subject, account.address, built, () => "perps");
    if (!prepared.ok) return Response.json({ error: prepared.block.code, message: prepared.block.message, traceId }, { status: 409 });
    return Response.json({ action: actionView(prepared.action), traceId }, { status: 201 });
  });
