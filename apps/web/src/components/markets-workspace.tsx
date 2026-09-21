"use client";

import { Ban, CheckCircle2, FileCheck2, Landmark, LockKeyhole, Scale } from "lucide-react";
import { evaluateProductEligibility, marketCapabilities } from "@/lib/markets/eligibility";

const categoryIcon = { treasury: Landmark, public_equity: Scale, private_market: LockKeyhole };

export function MarketsWorkspace() {
  return <><div className="notice marketNotice"><Ban size={18} /><span><strong>Trading is disabled by design.</strong> A token address and a liquid pool do not establish that an instrument may lawfully be offered, solicited, or traded for a particular customer.</span></div><div className="marketGrid">{marketCapabilities.map((product) => {
    const Icon = categoryIcon[product.category];
    const eligibility = evaluateProductEligibility(product, { identityVerified: false, acceptedDocumentUrls: [] });
    return <article className="panel marketCard" key={product.key}><div className="marketCardTop"><span className="benefitIcon"><Icon size={21} /></span><span className="statusBadge neutral">Not enabled</span></div><h2>{product.name}</h2><p>{product.description}</p><div className="marketGates">{eligibility.gates.slice(0, 5).map((gate) => <div key={gate.gate}><span>{gate.passed ? <CheckCircle2 size={14} /> : <LockKeyhole size={14} />}</span><div><strong>{gate.gate.replaceAll("_", " ")}</strong><small>{gate.reason}</small></div></div>)}</div><button className="button secondary full" disabled><FileCheck2 size={15} /> Provider and legal review required</button></article>;
  })}</div><section className="panel frameworkPanel"><p className="eyebrow">FAIL-CLOSED LISTING STANDARD</p><h2>What must exist before a market appears</h2><div className="frameworkSteps"><div><strong>1</strong><span>Identify the legal instrument, issuer, holder rights, and token-to-record relationship.</span></div><div><strong>2</strong><span>Approve the platform’s role, customer jurisdictions, solicitation model, and identity requirements.</span></div><div><strong>3</strong><span>Validate transfer restrictions, venue authorization, liquidity, pricing, custody, tax, and disclosures.</span></div><div><strong>4</strong><span>Enable one versioned product record; re-check eligibility and liquidity before every order.</span></div></div></section></>;
}
