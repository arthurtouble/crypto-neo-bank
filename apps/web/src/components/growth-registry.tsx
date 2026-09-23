"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useQuery } from "@tanstack/react-query";
import { FlaskConical, Link2, Plus } from "lucide-react";
import { useState } from "react";

type Campaign = { campaign_id: string; name: string; slug: string; campaign_type: string; status: string; approved_countries_json: string };
type Experiment = { experiment_id: string; name: string; primary_metric: string; status: string; variants_json: string };

export function GrowthRegistry() {
  const { getAccessToken, user } = usePrivy();
  const [tab, setTab] = useState<"campaigns" | "experiments">("campaigns");
  const [message, setMessage] = useState<string | null>(null);
  async function authorized(url: string, init?: RequestInit) { const token = await getAccessToken(); return fetch(url, { ...init, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init?.body ? { "Content-Type": "application/json" } : {}) }, cache: "no-store" }); }
  const campaigns = useQuery<{ campaigns: Campaign[] }>({ queryKey: ["growth-campaigns", user?.id], enabled: Boolean(user), retry: false, queryFn: async () => { const response = await authorized("/api/ops/growth/campaigns"); if (!response.ok) throw new Error("Campaigns are unavailable."); return response.json(); } });
  const experiments = useQuery<{ experiments: Experiment[] }>({ queryKey: ["growth-experiments", user?.id], enabled: Boolean(user), retry: false, queryFn: async () => { const response = await authorized("/api/ops/growth/experiments"); if (!response.ok) throw new Error("Experiments are unavailable."); return response.json(); } });

  async function createCampaign(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMessage(null); const form = new FormData(event.currentTarget);
    const slug = String(form.get("slug"));
    const response = await authorized("/api/ops/growth/campaigns", { method: "POST", body: JSON.stringify({ slug, name: form.get("name"), campaignType: form.get("campaignType"), approvedCountries: String(form.get("countries")).split(",").map((item) => item.trim().toUpperCase()).filter(Boolean), status: "draft" }) });
    if (!response.ok) { setMessage("Campaign could not be created."); return; }
    setMessage(`Campaign created: /waitlist?partner=${slug}&utm_campaign=${slug}`); event.currentTarget.reset(); await campaigns.refetch();
  }
  async function createExperiment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMessage(null); const form = new FormData(event.currentTarget);
    const response = await authorized("/api/ops/growth/experiments", { method: "POST", body: JSON.stringify({ name: form.get("name"), hypothesis: form.get("hypothesis"), primaryMetric: form.get("primaryMetric"), variants: String(form.get("variants")).split(",").map((item) => item.trim().toLowerCase()).filter(Boolean), guardrails: ["support_rate", "waitlist_error_rate"], status: "draft" }) });
    if (!response.ok) { setMessage("Experiment could not be created."); return; }
    setMessage("Draft experiment created."); event.currentTarget.reset(); await experiments.refetch();
  }

  return <section className="panel growthRegistry"><div className="registryHeader"><div><h3>Campaign & Experiment Registry</h3><p>Drafts stay inactive until an operator explicitly starts them.</p></div><div className="registryTabs"><button className={tab === "campaigns" ? "active" : ""} onClick={() => setTab("campaigns")}><Link2 size={14} /> Campaigns</button><button className={tab === "experiments" ? "active" : ""} onClick={() => setTab("experiments")}><FlaskConical size={14} /> Experiments</button></div></div>
    {tab === "campaigns" ? <div className="registryBody"><div className="registryList">{campaigns.data?.campaigns.length ? campaigns.data.campaigns.map((item) => <article key={item.campaign_id}><span><strong>{item.name}</strong><small>{item.slug} · {item.campaign_type}</small></span><span className="statusBadge neutral">{item.status}</span></article>) : <div className="emptyState">No campaigns yet.</div>}</div><form className="registryForm" onSubmit={(event) => void createCampaign(event)}><h4>New Campaign</h4><input name="name" aria-label="Campaign name" placeholder="Campaign name" required minLength={2} maxLength={100} /><input name="slug" aria-label="Campaign slug" placeholder="campaign-slug" required pattern="[a-z0-9-]{2,80}" /><select name="campaignType" aria-label="Campaign type" defaultValue="content"><option value="founder">Founder</option><option value="partner">Partner</option><option value="content">Content</option><option value="creator">Creator</option><option value="event">Event</option><option value="paid">Paid</option></select><input name="countries" aria-label="Approved countries" placeholder="PT" required /><button className="button secondary"><Plus size={14} /> Create Draft</button></form></div> : <div className="registryBody"><div className="registryList">{experiments.data?.experiments.length ? experiments.data.experiments.map((item) => <article key={item.experiment_id}><span><strong>{item.name}</strong><small>{item.primary_metric} · {JSON.parse(item.variants_json).join(" / ")}</small></span><span className="statusBadge neutral">{item.status}</span></article>) : <div className="emptyState">No experiments yet.</div>}</div><form className="registryForm" onSubmit={(event) => void createExperiment(event)}><h4>New Experiment</h4><input name="name" aria-label="Experiment name" placeholder="Experiment name" required minLength={3} /><textarea name="hypothesis" aria-label="Experiment hypothesis" placeholder="We expect this change to improve…" required minLength={10} /><select name="primaryMetric" aria-label="Primary metric" defaultValue="waitlist_joined_rate"><option value="waitlist_joined_rate">Waitlist joined rate</option><option value="invite_acceptance_rate">Invite acceptance rate</option></select><input name="variants" aria-label="Experiment variants" placeholder="control, variant-a" required /><button className="button secondary"><Plus size={14} /> Create Draft</button></form></div>}
    {message && <p className="registryMessage" role="status">{message}</p>}
  </section>;
}
