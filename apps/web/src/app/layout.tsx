import type { Metadata } from "next";
import { indexable, siteOrigin } from "@/lib/site/seo";
import "./globals.css";
import "./identity.css";
import "./product-system.css";
// The redesign's tokens (also served at /design-tokens.css for the reference page), then the rebuilt app shell.
import "../../public/design-tokens.css";
import "./shell.css";
import "./overview.css";
import "./money.css";
import "./cards.css";
import "./records.css";
import "./settings.css";
import "./public.css";

const description = "One app for the money you hold yourself. See every balance, then send, swap, or earn. What you can use depends on where you live.";
const origin = siteOrigin();

export const metadata: Metadata = {
  ...(origin ? { metadataBase: new URL(origin) } : {}),
  title: { default: "Aura", template: "%s · Aura" },
  description,
  applicationName: "Aura",
  robots: indexable() ? { index: true, follow: true } : { index: false, follow: false },
  openGraph: { type: "website", siteName: "Aura", title: "Aura", description,
    images: [{ url: "/images/aura-overview.png", width: 960, height: 600, alt: "Aura's Overview with example balances" }] },
  twitter: { card: "summary_large_image", title: "Aura", description, images: ["/images/aura-overview.png"] }
};

// Set only by the dev deploy, so dev shows which commit it runs and production shows nothing.
const buildSha = process.env.NEXT_PUBLIC_BUILD_SHA;
const buildTime = process.env.NEXT_PUBLIC_BUILD_TIME;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: `(function(){try{var t=localStorage.getItem('aurel-theme');var d=t==='dark'||(!t&&matchMedia('(prefers-color-scheme:dark)').matches)?'dark':'light';document.documentElement.dataset.theme=d;document.documentElement.style.colorScheme=d;document.documentElement.dataset.balancePrivacy=localStorage.getItem('aurel-balance-privacy')==='hidden'?'hidden':'visible'}catch(e){}})()` }} /></head>
      <body>
        {children}
        {buildSha && <div className="buildTag" title={`Deployed from commit ${buildSha}${buildTime ? ` at ${buildTime}` : ""}`}>dev · {buildSha}{buildTime ? ` · ${buildTime}` : ""}</div>}
      </body>
    </html>
  );
}
