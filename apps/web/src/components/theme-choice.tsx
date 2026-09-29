"use client";

import { useState } from "react";

type Choice = "device" | "light" | "dark";
const choices: { value: Choice; label: string }[] = [{ value: "device", label: "Device" }, { value: "light", label: "Light" }, { value: "dark", label: "Dark" }];

function stored(): Choice {
  try {
    const value = localStorage.getItem("aurel-theme");
    return value === "light" || value === "dark" ? value : "device";
  } catch { return "device"; }
}

/** Follow the device, or pin light or dark. Uses the same `aurel-theme` key the root layout reads before paint. */
function apply(choice: Choice) {
  const dark = choice === "dark" || (choice === "device" && matchMedia("(prefers-color-scheme: dark)").matches);
  const theme = dark ? "dark" : "light";
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  try {
    if (choice === "device") localStorage.removeItem("aurel-theme");
    else localStorage.setItem("aurel-theme", choice);
  } catch { /* The choice still applies for this page. */ }
}

export function ThemeChoice() {
  // Only rendered inside menus opened on the client, so reading storage here can't mismatch the server render.
  const [choice, setChoice] = useState<Choice>(() => typeof window === "undefined" ? "device" : stored());
  return <div className="appSegmented" role="group" aria-label="Theme">
    {choices.map((item) => <button key={item.value} type="button" aria-pressed={choice === item.value}
      onClick={() => { apply(item.value); setChoice(item.value); }}>{item.label}</button>)}
  </div>;
}
