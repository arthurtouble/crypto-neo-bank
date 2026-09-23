import type { Metadata } from "next";
import Link from "next/link";
import { Brand } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";
import { WaitlistForm } from "@/components/waitlist-form";

export const metadata: Metadata = { title: "Join the waitlist — Aurel", description: "Join Aurel's global private-beta waitlist with your email." };

export default function WaitlistPage() {
  return <div className="publicFlowPage waitlistPage">
    <header className="publicFlowHeader"><Brand /><div><Link href="/">← Home</Link><ThemeToggle /></div></header>
    <main className="waitlistMain"><div className="waitlistIntro"><p className="eyebrow">AUREL PRIVATE BETA</p><h1>A more considered way to manage digital assets.</h1><p>We’re building a clear place to see what you hold and understand each action before you take it. Join the waitlist for updates on access.</p><span>One email. No application.</span></div><WaitlistForm /></main>
  </div>;
}
