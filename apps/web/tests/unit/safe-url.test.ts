import { describe, expect, it } from "vitest";
import { httpsUrl } from "@/lib/client/safe-url";

describe("httpsUrl", () => {
  it("passes https links and refuses everything else", () => {
    expect(httpsUrl("https://bridge.example/kyc/1?x=y")).toBe("https://bridge.example/kyc/1?x=y");
    for (const bad of ["http://bridge.example/kyc", "javascript:alert(1)", "data:text/html,<b>x</b>", "//bridge.example", "bridge.example", "https://", "", null, undefined, 3]) {
      expect(httpsUrl(bad), String(bad)).toBeNull();
    }
  });
});
