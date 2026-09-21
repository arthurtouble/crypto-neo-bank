import type { Metadata } from "next";
import { Fragment_Mono, Instrument_Sans, Newsreader } from "next/font/google";
import "./globals.css";

const instrument = Instrument_Sans({ subsets: ["latin"], variable: "--font-sans" });
const newsreader = Newsreader({ subsets: ["latin"], variable: "--font-display" });
const mono = Fragment_Mono({ weight: "400", subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "Aurel — Onchain wealth, usable everywhere",
  description: "A secure financial operating system for onchain wealth."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: `(function(){try{var t=localStorage.getItem('aurel-theme');var d=t==='dark'||(!t&&matchMedia('(prefers-color-scheme:dark)').matches)?'dark':'light';document.documentElement.dataset.theme=d;document.documentElement.style.colorScheme=d}catch(e){}})()` }} /></head>
      <body className={`${instrument.variable} ${newsreader.variable} ${mono.variable}`}>
        {children}
      </body>
    </html>
  );
}
