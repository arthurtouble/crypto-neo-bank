"use client";

import * as Dialog from "@radix-ui/react-dialog";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Command, Search, X } from "lucide-react";

const destinations = [
  { label: "Overview", note: "Relationship summary", href: "/app" },
  { label: "Assets", note: "Wallets and positions", href: "/app/assets" },
  { label: "Earn", note: "Curated strategies", href: "/app/earn" },
  { label: "Activity", note: "Transfers and authorizations", href: "/app/activity" },
  { label: "Safety center", note: "Account controls", href: "/app/security" },
  { label: "Documentation", note: "Custody and provider model", href: "/docs" },
];

export function CommandMenu() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return term ? destinations.filter((item) => `${item.label} ${item.note}`.toLowerCase().includes(term)) : destinations;
  }, [query]);

  return (
    <Dialog.Root open={open} onOpenChange={(value) => { setOpen(value); if (!value) setQuery(""); }}>
      <Dialog.Trigger asChild>
        <button className="commandSearch" type="button" aria-label="Open search and commands"><Search size={16} /><span>Search Aurel</span><kbd><Command size={11} /> K</kbd></button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="dialogOverlay" />
        <Dialog.Content className="dialogContent commandDialog">
          <Dialog.Title className="srOnly">Search Aurel</Dialog.Title>
          <Dialog.Description className="srOnly">Navigate to a product area or documentation page.</Dialog.Description>
          <div className="commandInput"><Search size={17} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search pages and actions" /><Dialog.Close aria-label="Close search"><X size={17} /></Dialog.Close></div>
          <div className="commandResults">
            <p>Go to</p>
            {filtered.map((item) => <Dialog.Close asChild key={item.href}><Link href={item.href}><span><strong>{item.label}</strong><small>{item.note}</small></span><ArrowRight size={15} /></Link></Dialog.Close>)}
            {!filtered.length && <div className="commandEmpty">No results. Try “security” or “assets”.</div>}
          </div>
          <div className="commandFooter"><span>↑↓ Navigate</span><span>↵ Open</span><span>Esc Close</span></div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
