"use client";

import * as Dialog from "@radix-ui/react-dialog";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ArrowDownToLine, ArrowDownUp, ArrowUpFromLine, Building2, ChevronRight, Command, LockKeyhole, Search, X, type LucideIcon } from "lucide-react";
import { navigation } from "@/lib/product-map";

type Entry = { label: string; note: string; href: string; icon?: LucideIcon; keywords?: string };

/**
 * Change B4: things to do, not only places to go. Each opens where the action happens; nothing moves money or changes
 * a control from here, so the customer still reviews and confirms it there.
 */
const actions: Entry[] = [
  { label: "Send money", note: "To a person, wallet, or Aura tag", href: "/app/send", icon: ArrowUpFromLine, keywords: "pay transfer crypto" },
  { label: "Send to a bank", note: "Dollars to a US bank account", href: "/app/send#bank", icon: Building2, keywords: "payout cash out withdraw" },
  { label: "Add money", note: "Your address, a wallet, card, or bank", href: "/app/deposit", icon: ArrowDownToLine, keywords: "add receive fund top up address" },
  { label: "Swap assets", note: "Buy or sell crypto, stocks, and gold", href: "/app/swap", icon: ArrowDownUp, keywords: "buy sell trade exchange convert" },
  { label: "Lock my account", note: "The emergency lock, in Settings", href: "/app/settings#emergency-lock", icon: LockKeyhole, keywords: "freeze stop security hacked stolen" }
];
const pages: Entry[] = navigation.flatMap((group) => group.items.map((item) => ({ label: item.label, note: group.group, href: item.href })));

const matches = (entry: Entry, term: string) => `${entry.label} ${entry.note} ${entry.keywords ?? ""}`.toLowerCase().includes(term);

export function CommandMenu() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

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

  const groups = useMemo(() => {
    const term = query.trim().toLowerCase();
    return [{ title: "Actions", entries: term ? actions.filter((entry) => matches(entry, term)) : actions },
      { title: "Go to", entries: term ? pages.filter((entry) => matches(entry, term)) : pages }].filter((group) => group.entries.length);
  }, [query]);
  const flat = groups.flatMap((group) => group.entries);
  const current = Math.min(active, Math.max(flat.length - 1, 0));
  // Keep the chosen result in view as the arrow keys move through a long list.
  useEffect(() => { if (open) document.getElementById(`command-option-${current}`)?.scrollIntoView({ block: "nearest" }); }, [open, current]);

  function close(value: boolean) { setOpen(value); if (!value) { setQuery(""); setActive(0); } }
  function go(entry: Entry | undefined) {
    if (!entry) return;
    close(false);
    router.push(entry.href);
  }

  return (
    <Dialog.Root open={open} onOpenChange={close}>
      <Dialog.Trigger asChild>
        <button className="commandSearch" type="button" aria-label="Open search and commands"><Search size={16} /><span>Search Aura</span><kbd><Command size={11} /> K</kbd></button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="mxDialogOverlay" />
        <Dialog.Content className="mxDialog cmDialog" aria-describedby="command-help">
          <Dialog.Title className="srOnly">Search Aura</Dialog.Title>
          <p id="command-help" className="srOnly">Find an action or a page. Use the arrow keys to choose, and Enter to open it.</p>
          <div className="cmInput"><Search aria-hidden="true" />
            <input autoFocus role="combobox" aria-expanded="true" aria-controls="command-results" aria-activedescendant={flat.length ? `command-option-${current}` : undefined}
              aria-label="Search actions and pages" value={query} placeholder="Search actions and pages"
              onChange={(event) => { setQuery(event.target.value); setActive(0); }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  if (flat.length) setActive((current + (event.key === "ArrowDown" ? 1 : flat.length - 1)) % flat.length);
                } else if (event.key === "Enter") { event.preventDefault(); go(flat[current]); }
              }} />
            <Dialog.Close className="appIconButton" aria-label="Close search"><X aria-hidden="true" /></Dialog.Close></div>
          <div className="cmResults" id="command-results" role="listbox" aria-label="Actions and pages">
            {groups.map((group) => <div key={group.title} role="group" aria-label={group.title}>
              <p className="cmGroup" aria-hidden="true">{group.title}</p>
              {group.entries.map((entry) => {
                const index = flat.indexOf(entry);
                const Icon = entry.icon ?? ChevronRight;
                return <Link key={`${group.title}-${entry.href}`} id={`command-option-${index}`} role="option" aria-selected={index === current} tabIndex={-1} href={entry.href}
                  className="cmOption" onMouseEnter={() => setActive(index)} onClick={(event) => { event.preventDefault(); go(entry); }}>
                  <span className="cmIcon" aria-hidden="true"><Icon /></span><span className="cmText"><strong>{entry.label}</strong><small>{entry.note}</small></span></Link>;
              })}
            </div>)}
            {!flat.length && <p className="cmEmpty">Nothing matches. Try a page name, or words like send, add, or lock.</p>}
          </div>
          <div className="cmFooter" aria-hidden="true"><span>↑↓ Choose</span><span>↵ Open</span><span>Esc Close</span></div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
