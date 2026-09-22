import type { Metadata } from "next";
import "@fontsource-variable/archivo";
import "./globals.css";
import "./identity.css";

export const metadata: Metadata = {
  title: "Aurel — Your financial life, in one place",
  description: "A secure account for money, digital assets, investing, and everyday benefits."
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
