import type { Metadata } from "next";
import "@fontsource-variable/archivo";
import "./globals.css";
import "./identity.css";
import "./product-system.css";

export const metadata: Metadata = {
  title: "Aurel — Know what you hold",
  description: "See supported digital assets and wallet activity in one place. Join the private-beta waitlist with your email."
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
