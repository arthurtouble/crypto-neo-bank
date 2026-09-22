import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Brand } from "@/components/brand";
import { PrivateAccessApplication } from "@/components/private-access-application";
import { ThemeToggle } from "@/components/theme-toggle";

export const metadata: Metadata = { title: "Apply for private access — Aurel", description: "Apply to join a small Aurel private-access cohort." };

export default function ApplyPage() {
  return <div className="publicFlowPage"><header className="publicFlowHeader"><Brand /><div><Link href="/"><ArrowLeft size={15} /> Home</Link><ThemeToggle /></div></header><main className="publicFlowMain"><section className="applicationIntro"><p className="eyebrow">PRIVATE ACCESS</p><h1>Tell us what you need.</h1><p>We open Aurel in small, approved-country cohorts. Applying does not create an account, reserve a place, or ask you to deposit anything.</p><div className="applicationPromises"><span>About three minutes</span><span>No wallet address</span><span>No deposit</span></div></section><PrivateAccessApplication /></main></div>;
}
