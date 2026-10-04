import { useQuery } from "@tanstack/react-query";
import { Activity, BarChart3, CircleAlert, SlidersHorizontal, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "./api";
import { Controls } from "./Controls";
import { Customers } from "./Customers";
import { Issues, useSummary } from "./Issues";
import { Movement } from "./Movement";
import { Stats } from "./Stats";

const pages = [
  { key: "issues", label: "Issues", icon: CircleAlert },
  { key: "customers", label: "Customers", icon: Users },
  { key: "movement", label: "Money movement", icon: Activity },
  { key: "stats", label: "Stats", icon: BarChart3 },
  { key: "controls", label: "Controls", icon: SlidersHorizontal }
] as const;
type Page = (typeof pages)[number]["key"];

/**
 * Where we are: `#customers?subject=did:privy:…` opens one customer (or any search: an email, wallet, or Aura tag), `#movement?subject=…` Money movement for one
 * customer, and `&action=<id>` that action's journey.
 */
function readHash(): { page: Page; subject: string | null; action: string | null } {
  const [page, query] = location.hash.slice(1).split("?");
  const known = pages.some((item) => item.key === page) ? page as Page : "customers";
  const params = new URLSearchParams(query ?? "");
  return { page: known, subject: params.get("subject"), action: params.get("action") };
}

export function App() {
  const [location_, setLocation] = useState(readHash);
  useEffect(() => {
    const update = () => setLocation(readHash());
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<{ email: string }>("me") });
  const summary = useSummary();
  const open = summary.data?.issues.length ?? 0;
  const go = (page: Page, subject?: string) => { location.hash = subject ? `${page}?subject=${encodeURIComponent(subject)}` : page; };

  return <div className="shell">
    <header className="top">
      <strong>Aura operations</strong>
      <span className="who">{me.data?.email}</span>
    </header>
    <nav className="nav" aria-label="Operations">
      {!me.isError && pages.map(({ key, label, icon: Icon }) => <a key={key} href={`#${key}`} aria-current={location_.page === key ? "page" : undefined}><Icon size={16} />{label}
        {key === "issues" && open > 0 && <span className="count" aria-label={`${open} open`}>{open}</span>}</a>)}
    </nav>
    <main className="main">
      {me.isError ? <div className="notice error" role="alert">{me.error.message}</div> : <>
        {location_.page === "issues" && <Issues />}
        {location_.page === "customers" && <Customers key={location_.subject ?? ""} subject={location_.subject} onMovement={(subject) => go("movement", subject)} />}
        {location_.page === "movement" && <Movement key={location_.action ?? ""} subject={location_.subject} action={location_.action} onClearSubject={() => go("movement")} />}
        {location_.page === "stats" && <Stats />}
        {location_.page === "controls" && <Controls />}
      </>}
    </main>
  </div>;
}
