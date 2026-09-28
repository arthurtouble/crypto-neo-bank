import { useQuery } from "@tanstack/react-query";
import { Activity, BarChart3, SlidersHorizontal, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "./api";
import { Controls } from "./Controls";
import { Customers } from "./Customers";
import { Movement } from "./Movement";
import { Stats } from "./Stats";

const pages = [
  { key: "customers", label: "Customers", icon: Users },
  { key: "movement", label: "Money movement", icon: Activity },
  { key: "stats", label: "Stats", icon: BarChart3 },
  { key: "controls", label: "Controls", icon: SlidersHorizontal }
] as const;
type Page = (typeof pages)[number]["key"];

/** Where we are: `#movement?subject=did:privy:…` opens Money movement for one customer. */
function readHash(): { page: Page; subject: string | null } {
  const [page, query] = location.hash.slice(1).split("?");
  const known = pages.some((item) => item.key === page) ? page as Page : "customers";
  return { page: known, subject: new URLSearchParams(query ?? "").get("subject") };
}

export function App() {
  const [location_, setLocation] = useState(readHash);
  useEffect(() => {
    const update = () => setLocation(readHash());
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<{ email: string }>("me") });
  const go = (page: Page, subject?: string) => { location.hash = subject ? `${page}?subject=${encodeURIComponent(subject)}` : page; };

  return <div className="shell">
    <header className="top">
      <strong>Aura operations</strong>
      <span className="who">{me.data ? me.data.email : me.isError ? "" : "…"}</span>
    </header>
    <nav className="nav" aria-label="Operations">
      {pages.map(({ key, label, icon: Icon }) => <a key={key} href={`#${key}`} aria-current={location_.page === key ? "page" : undefined}><Icon size={16} />{label}</a>)}
    </nav>
    <main className="main">
      {me.isError ? <div className="notice error" role="alert">{me.error.message}</div> : <>
        {location_.page === "customers" && <Customers onMovement={(subject) => go("movement", subject)} />}
        {location_.page === "movement" && <Movement subject={location_.subject} onClearSubject={() => go("movement")} />}
        {location_.page === "stats" && <Stats />}
        {location_.page === "controls" && <Controls />}
      </>}
    </main>
  </div>;
}
