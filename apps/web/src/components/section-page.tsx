import type { CustomerSection } from "@/lib/product-map";
import { ActivityWorkspace } from "./activity-workspace";
import { CardWorkspace } from "./card-workspace";
import { DepositPage } from "./deposit-page";
import { EarnWorkspace } from "./earn-workspace";
import { InsightsWorkspace } from "./insights-workspace";
import { SendPage } from "./send-page";
import { SettingsWorkspace } from "./settings-workspace";
import { SupportWorkspace } from "./support-workspace";
import { SwapPage } from "./swap-page";

/** Every section draws its own title and layout (rebuilt in the redesign, phase 5). */
export function SectionPage({ section }: { section: CustomerSection }) {
  if (section === "deposit") return <DepositPage />;
  if (section === "send") return <SendPage />;
  if (section === "swap") return <SwapPage />;
  if (section === "earn") return <EarnWorkspace />;
  if (section === "cards") return <CardWorkspace />;
  if (section === "transactions") return <ActivityWorkspace />;
  if (section === "insights") return <InsightsWorkspace />;
  if (section === "settings") return <SettingsWorkspace />;
  return <SupportWorkspace />;
}
