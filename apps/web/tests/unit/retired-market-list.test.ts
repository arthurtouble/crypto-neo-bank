import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/market-data/route";

describe("retired public markets list", () => {
  it("does not fetch or publish a markets catalog", async () => {
    const response = await GET();
    expect(response.status).toBe(410);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "markets_list_retired" });
  });
});
