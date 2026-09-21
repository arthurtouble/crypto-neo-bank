"use client";

import { Ban, CheckCircle2, FileCheck2, Landmark, LockKeyhole, Scale } from "lucide-react";
import { evaluateProductEligibility, marketCapabilities } from "@/lib/markets/eligibility";

const categoryIcon = { treasury: Landmark, public_equity: Scale, private_market: LockKeyhole };

export function MarketsWorkspace() {
  return <><div className="notice marketNotice"><Ban size={18} /><span><strong>Trading is not available.</strong> A token and a liquid pool are not enough. Aurel must confirm the product, provider, country rules, and customer eligibility first.</span></div><div className="marketGrid">{marketCapabilities.map((product) => {
    const Icon = categoryIcon[product.category];
    const eligibility = evaluateProductEligibility(product, { identityVerified: false, acceptedDocumentUrls: [] });
    return <article className="panel marketCard" key={product.key}><div className="marketCardTop"><span className="benefitIcon"><Icon size={21} /></span><span className="statusBadge neutral">Not available</span></div><h2>{product.name}</h2><p>{product.description}</p><div className="marketGates">{eligibility.gates.slice(0, 5).map((gate) => <div key={gate.gate}><span>{gate.passed ? <CheckCircle2 size={14} /> : <LockKeyhole size={14} />}</span><div><strong>{gate.gate.replaceAll("_", " ")}</strong><small>{gate.reason}</small></div></div>)}</div><button className="button secondary full" disabled><FileCheck2 size={15} /> Review required</button></article>;
  })}</div><section className="panel frameworkPanel"><p className="eyebrow">Before a market opens</p><h2>Every product must pass four checks</h2><div className="frameworkSteps"><div><strong>1</strong><span>Confirm the issuer, legal instrument, holder rights, and token record.</span></div><div><strong>2</strong><span>Confirm where Aurel can offer it and which customers are eligible.</span></div><div><strong>3</strong><span>Check transfer limits, venue, liquidity, pricing, custody, tax, and disclosures.</span></div><div><strong>4</strong><span>Publish one approved record and recheck eligibility before each order.</span></div></div></section></>;
}
