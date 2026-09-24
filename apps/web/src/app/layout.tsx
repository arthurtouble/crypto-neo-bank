import type { Metadata } from "next";
import "@fontsource-variable/archivo";
import "./globals.css";
import "./identity.css";
import "./product-system.css";

export const metadata: Metadata = {
  title: "Aura — Your Smart Account",
  description: "Spend anywhere, invest in global markets, and get incredible rewards. All from one app. Availability varies."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: `(function(){try{var t=localStorage.getItem('aurel-theme');var d=t==='dark'||(!t&&matchMedia('(prefers-color-scheme:dark)').matches)?'dark':'light';document.documentElement.dataset.theme=d;document.documentElement.style.colorScheme=d;document.documentElement.dataset.balancePrivacy=localStorage.getItem('aurel-balance-privacy')==='hidden'?'hidden':'visible'}catch(e){}})()` }} /></head>
      <body>
        {children}
      </body>
    </html>
  );
}
