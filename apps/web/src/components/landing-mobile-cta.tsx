"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

/**
 * The phone's pinned "Get started", shown only once the hero's own actions
 * (`.ldActions`) have scrolled out of view, so it never covers the hero or its
 * screenshot. Hidden only visually until then: it stays in the page for
 * keyboard and screen reader users, and shows when focused.
 */
export function LandingMobileCta() {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const hero = document.querySelector(".ldActions");
    if (!hero) return;
    const observer = new IntersectionObserver(([entry]) => setShown(!entry.isIntersecting && entry.boundingClientRect.top < 0));
    observer.observe(hero);
    return () => observer.disconnect();
  }, []);
  return <Link className="ldMobileCta appButton appButtonPrimary appButtonLarge" data-shown={shown} href="/app">Get started</Link>;
}
