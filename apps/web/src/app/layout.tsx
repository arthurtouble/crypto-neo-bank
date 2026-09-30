import type { Metadata } from "next";
import "@fontsource-variable/archivo";
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

export const metadata: Metadata = {
  title: "Aura — Your Smart Account",
  description: "Spend anywhere, invest in global markets, and earn on your money. All from one app. Availability varies."
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
