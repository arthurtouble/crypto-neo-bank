import type { Metadata } from "next";
import Link from "next/link";
import { Brand } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";
import { WaitlistForm } from "@/components/waitlist-form";
import { GrowthTracker } from "@/components/growth-tracker";

export const metadata: Metadata = { title: "Join the waitlist — Aurel", description: "Join Aurel's global private-beta waitlist with your email." };

export default function WaitlistPage() {
  return <div className="publicFlowPage waitlistPage">
    <GrowthTracker eventName="waitlist_viewed" />
    <header className="publicFlowHeader"><Brand /><div><Link href="/">← Home</Link><ThemeToggle /></div></header>
    <main className="waitlistMain"><div className="waitlistIntro"><p className="eyebrow">PRIVATE BETA</p><h1>Join the waitlist.</h1><p>Leave your email. We’ll get in touch if we can offer you access.</p></div><WaitlistForm privacyNoticeVersion={process.env.GROWTH_PRIVACY_NOTICE_VERSION ?? "2026-09-23"} /></main>
  </div>;
}
