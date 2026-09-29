import dynamic from "next/dynamic";
import type { CustomerSection } from "@/lib/product-map";
import { DepositPage } from "./deposit-page";
import { SwapWorkspace } from "./swap-workspace";

const MoneyWorkspace = dynamic(() => import("./money-workspace").then((mod) => mod.MoneyWorkspace));
const EarnWorkspace = dynamic(() => import("./earn-workspace").then((mod) => mod.EarnWorkspace));
const CardWorkspace = dynamic(() => import("./card-workspace").then((mod) => mod.CardWorkspace));
const ActivityWorkspace = dynamic(() => import("./activity-workspace").then((mod) => mod.ActivityWorkspace));
const InsightsWorkspace = dynamic(() => import("./insights-workspace").then((mod) => mod.InsightsWorkspace));
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
  return <div>
    <section className="pageIntro compact"><div><h1>{titles[section]}</h1></div></section>
    {section === "send" && <MoneyWorkspace mode={section} />}
    {section === "swap" && <SwapWorkspace />}
    {section === "earn" && <EarnWorkspace />}
    {section === "cards" && <CardWorkspace />}
    {section === "transactions" && <ActivityWorkspace />}
    {section === "insights" && <InsightsWorkspace />}
    {section === "settings" && <SettingsWorkspace />}
    {section === "support" && <SupportWorkspace />}
  </div>;
}
