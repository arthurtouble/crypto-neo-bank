"use client";

import { LiFiWidget } from "@lifi/widget";
import { useEffect, useState } from "react";
import { swapWidgetConfig } from "@/lib/swap/widget-config";

export function LifiSwapWorkspace() {
  const [appearance, setAppearance] = useState<"light" | "dark">("light");
  useEffect(() => {
    const sync = () => setAppearance(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);
  return <section aria-label="Swap assets" className="lifiSwapWorkspace">
    <LiFiWidget integrator="aurel" config={{ ...swapWidgetConfig, appearance }} />
  </section>;
}
