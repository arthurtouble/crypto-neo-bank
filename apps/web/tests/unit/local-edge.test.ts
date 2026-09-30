import { afterEach, describe, expect, it, vi } from "vitest";
import { RPC_BY_CHAIN, rpcEndpoints } from "@/lib/chain/rpc";
import { localEdgeUrl } from "@/lib/testing/local-edge";

describe("end-to-end test overrides", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("only take effect for loopback URLs", () => {
    vi.stubEnv("PRIVY_API_URL", "http://127.0.0.1:43174/privy/");
    expect(localEdgeUrl("PRIVY_API_URL")).toBe("http://127.0.0.1:43174/privy");
    vi.stubEnv("PRIVY_API_URL", "http://localhost:43174/privy");
    expect(localEdgeUrl("PRIVY_API_URL")).toBe("http://localhost:43174/privy");
    for (const value of ["https://api.privy.io", "http://attacker.example", "https://127.0.0.1:43174", "http://127.0.0.1.attacker.example", "not a url", ""]) {
      vi.stubEnv("PRIVY_API_URL", value);
      expect(localEdgeUrl("PRIVY_API_URL"), value).toBeNull();
    }
  });

  it("use a local chain node alone, so a test never reaches a public network", () => {
    vi.stubEnv("RPC_URL_8453", "http://127.0.0.1:43174/rpc/8453");
    expect(rpcEndpoints(8453)).toEqual(["http://127.0.0.1:43174/rpc/8453"]);
    vi.stubEnv("RPC_URL_8453", "");
    expect(rpcEndpoints(8453)).toEqual(RPC_BY_CHAIN[8453]);
  });
});
