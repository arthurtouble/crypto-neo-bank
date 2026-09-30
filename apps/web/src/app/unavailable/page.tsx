import type { Metadata } from "next";
import Link from "next/link";
import { AppBrand } from "@/components/brand";

const docs = process.env.NEXT_PUBLIC_DOCS_URL ?? "https://aurel-docs.aurel-events.workers.dev";

export const metadata: Metadata = { title: "Not available where you are", robots: { index: false } };

/** What someone in a sanctioned place sees instead of the app or a payment page (worker/index.ts, lib/legal/places.ts). */
export default function UnavailablePage() {
  return <div className="pyPage">
    <header className="pyHeader"><AppBrand href="/" /></header>
    <main className="pyMain">
      <section className="pyCard pyUnavailable">
        <h1>Aura isn&apos;t available where you are</h1>
        <p>Sanctions laws don&apos;t let us offer Aura in your country or region. You can still read about Aura and our terms.</p>
        <Link className="appButton appButtonPrimary" href="/">Go to the home page</Link>
        <a className="appButton" href={`${docs}/legal/terms-of-use/`}>Read the terms</a>
      </section>
    </main>
  </div>;
}
