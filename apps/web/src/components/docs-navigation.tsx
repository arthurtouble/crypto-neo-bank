"use client";

import { useEffect, useState } from "react";

export function DocsNavigation({ entries }: { entries: Array<{ id: string; label: string }> }) {
  const [activeId, setActiveId] = useState(entries[0]?.id ?? "");

  useEffect(() => {
    const sections = entries.map(({ id }) => document.getElementById(id)).filter((section): section is HTMLElement => Boolean(section));
    const observer = new IntersectionObserver((observations) => {
      const visible = observations.filter((observation) => observation.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible[0]?.target.id) setActiveId(visible[0].target.id);
    }, { rootMargin: "-18% 0px -72%", threshold: 0 });
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [entries]);

  return <nav aria-label="Documentation sections">{entries.map(({ id, label }) => <a className={activeId === id ? "active" : ""} href={`#${id}`} key={id} aria-current={activeId === id ? "location" : undefined}>{label}</a>)}</nav>;
}
