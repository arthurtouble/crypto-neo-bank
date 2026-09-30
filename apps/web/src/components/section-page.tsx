import dynamic from "next/dynamic";
import type { CustomerSection } from "@/lib/product-map";
import { ActivityWorkspace } from "./activity-workspace";
import { CardWorkspace } from "./card-workspace";
import { DepositPage } from "./deposit-page";
import { EarnWorkspace } from "./earn-workspace";
import { InsightsWorkspace } from "./insights-workspace";
import { SendPage } from "./send-page";
import { SwapPage } from "./swap-page";

const SettingsWorkspace = dynamic(() => import("./settings-workspace").then((mod) => mod.SettingsWorkspace));
const SupportWorkspace = dynamic(() => import("./support-workspace").then((mod) => mod.SupportWorkspace));

const titles: Record<CustomerSection, string> = {
  deposit: "Deposit", send: "Send", swap: "Swap", earn: "Earn",
  cards: "Cards", transactions: "Transactions",
  insights: "Insights", settings: "Settings", support: "Support"
};

export function SectionPage({ section }: { section: CustomerSection }) {
  // Rebuilt in the redesign: the page draws its own title and layout.
  if (section === "deposit") return <DepositPage />;
  if (section === "send") return <SendPage />;
  if (section === "swap") return <SwapPage />;
  if (section === "earn") return <EarnWorkspace />;
  if (section === "cards") return <CardWorkspace />;
  if (section === "transactions") return <ActivityWorkspace />;
  if (section === "insights") return <InsightsWorkspace />;
  return <div>
    <section className="pageIntro compact"><div><h1>{titles[section]}</h1></div></section>
    {section === "settings" && <SettingsWorkspace />}
    {section === "support" && <SupportWorkspace />}
  </div>;
}
