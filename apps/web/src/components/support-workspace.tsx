import { SupportCasePanel } from "./support-case-panel";

const docs = process.env.NEXT_PUBLIC_DOCS_URL ?? "https://aurel-docs.aurel-events.workers.dev";

export function SupportWorkspace() {
  return <div className="moneySimple">
    <SupportCasePanel />
    <section className="panel settingsPanel"><h2>Docs and FAQs</h2><p>Read about setup, safety, and current availability.</p><div className="supportDocs"><a href={`${docs}/getting-started/status/`}>Product status</a><a href={`${docs}/safety/account-controls/`}>Account controls</a><a href={`${docs}/getting-started/setup/`}>Getting started</a></div></section>
  </div>;
}
