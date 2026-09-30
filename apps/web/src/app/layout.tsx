import type { Metadata, Viewport } from "next";
import { indexable, landingDescription, shareImage, siteOrigin, themeColors } from "@/lib/site/seo";
import "./globals.css";
import "./identity.css";
import "./product-system.css";
// The redesign's tokens (also served at /design-tokens.css for the reference page), then the rebuilt app shell.
import "../../public/design-tokens.css";
import "./shell.css";
import "./public.css";
// The app's own area stylesheets (overview, money, cards, records, settings) load with app/app/layout.tsx, so public pages don't carry them.

const description = landingDescription;
const origin = siteOrigin();

export const metadata: Metadata = {
  ...(origin ? { metadataBase: new URL(origin) } : {}),
  title: { default: "Aura", template: "%s · Aura" },
  description,
  applicationName: "Aura",
  // Added to the home screen (app/manifest.ts), Aura opens on its own, which iOS needs for push notices.
  appleWebApp: { capable: true, title: "Aura", statusBarStyle: "default" },
  robots: indexable() ? { index: true, follow: true } : { index: false, follow: false },
  openGraph: { type: "website", siteName: "Aura", title: "Aura", description,
    images: [shareImage] },
  twitter: { card: "summary_large_image", title: "Aura", description, images: [shareImage.url] }
};

// The browser's chrome follows the page canvas (--color-canvas in public/design-tokens.css), light and dark.
export const viewport: Viewport = {
  themeColor: [{ media: "(prefers-color-scheme: light)", color: themeColors.light }, { media: "(prefers-color-scheme: dark)", color: themeColors.dark }]
};

// Set only by the dev deploy, so dev shows which commit it runs and production shows nothing.
const buildSha = process.env.NEXT_PUBLIC_BUILD_SHA;
const buildTime = process.env.NEXT_PUBLIC_BUILD_TIME;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head><link rel="preload" href="/fonts/Geist-Variable.woff2" as="font" type="font/woff2" crossOrigin="anonymous" /><script dangerouslySetInnerHTML={{ __html: `(function(){try{var t=localStorage.getItem('aurel-theme');var d=t==='dark'||(!t&&matchMedia('(prefers-color-scheme:dark)').matches)?'dark':'light';document.documentElement.dataset.theme=d;document.documentElement.style.colorScheme=d;document.documentElement.dataset.balancePrivacy=localStorage.getItem('aurel-balance-privacy')==='hidden'?'hidden':'visible'}catch(e){}})()` }} /></head>
      <body>
        {children}
        {buildSha && <div className="buildTag" title={`Deployed from commit ${buildSha}${buildTime ? ` at ${buildTime}` : ""}`}>dev · {buildSha}{buildTime ? ` · ${buildTime}` : ""}</div>}
      </body>
    </html>
  );
}
