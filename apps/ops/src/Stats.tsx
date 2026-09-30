import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api, money, when } from "./api";

type Stats = {
  days: number;
  customers: { total: number; new: number; closed: number };
  actions: { completed: number; failed: number; stuck: number };
  volumeByKind: Array<{ kind: string; count: number; volumeUsd: number }>;
  funnel: Array<{ step: string; customers: number }>;
  daily: Array<{ day: string; signups: number; active: number; completed: number; volumeUsd: number }>;
  observedAt: string;
};

export function Stats() {
  const [days, setDays] = useState(30);
  const stats = useQuery({ queryKey: ["stats", days], queryFn: () => api<Stats>(`stats?days=${days}`) });
  const data = stats.data;
  const top = data?.funnel[0]?.customers || 1;
  return <section className="panel" aria-labelledby="stats-heading">
    <div className="headingRow"><h1 id="stats-heading">Stats</h1>
      <div className="segmented" role="group" aria-label="Period">{[7, 30, 90].map((value) => <button type="button" key={value} aria-pressed={days === value} onClick={() => setDays(value)}>{value} days</button>)}</div></div>
    {stats.isError && <div className="notice error" role="alert">{stats.error.message}</div>}
    {data && <>
      <div className="tiles">
        <article><span>Customers</span><strong data-testid="stat-customers">{data.customers.total}</strong><small>{data.customers.new} new, {data.customers.closed} closed</small></article>
        <article><span>Completed</span><strong>{data.actions.completed}</strong><small>{data.actions.failed} failed</small></article>
        <article><span>Stuck now</span><strong data-testid="stat-stuck">{data.actions.stuck}</strong><small>Submitted with no receipt</small></article>
        <article><span>Volume</span><strong>{money(data.volumeByKind.reduce((sum, row) => sum + row.volumeUsd, 0))}</strong><small>Value when prepared</small></article>
      </div>
      <h2>New customers in the period</h2>
      <div className="funnel">{data.funnel.map((step) => <div key={step.step} className="funnelRow" data-testid="funnel-step">
        <span>{step.step}</span><div className="bar"><i style={{ width: `${Math.max(step.customers ? 2 : 0, (step.customers / top) * 100)}%` }} /></div>
        <strong>{step.customers}</strong><span className="muted">{Math.round((step.customers / top) * 100)}%</span></div>)}</div>
      <h2>Volume by kind</h2>
      <div className="tableWrap"><table><thead><tr><th scope="col">Kind</th><th scope="col">Completed</th><th scope="col">Volume</th></tr></thead>
        <tbody>{data.volumeByKind.map((row) => <tr key={row.kind}><td>{row.kind}</td><td>{row.count}</td><td>{money(row.volumeUsd)}</td></tr>)}</tbody></table></div>
      {!data.volumeByKind.length && <p className="muted">No completed transactions in this period.</p>}
      <h2>By day</h2>
      <div className="tableWrap"><table><thead><tr><th scope="col">Day (UTC)</th><th scope="col">Sign-ups</th><th scope="col">Active</th><th scope="col">Completed</th><th scope="col">Volume</th></tr></thead>
        <tbody>{[...data.daily].reverse().map((row) => <tr key={row.day}><td>{row.day}</td><td>{row.signups}</td><td>{row.active}</td><td>{row.completed}</td><td>{money(row.volumeUsd)}</td></tr>)}</tbody></table></div>
      <p className="muted">From Aura&apos;s records, {when(data.observedAt)}. Money that arrived without an Aura action isn&apos;t counted. Active means the customer opened the app.</p>
    </>}
  </section>;
}
