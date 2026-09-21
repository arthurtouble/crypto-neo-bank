"use client";

import { Moon, Sun } from "lucide-react";

type Theme = "light" | "dark";

function currentTheme(): Theme {
  if (typeof document === "undefined") return "light";
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

export function ThemeToggle({ className = "" }: { className?: string }) {
  function toggleTheme() {
    const next: Theme = currentTheme() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    document.documentElement.style.colorScheme = next;
    localStorage.setItem("aurel-theme", next);
  }

  return (
    <button
      className={`themeToggle ${className}`}
      type="button"
      onClick={toggleTheme}
      aria-label="Toggle color theme"
      title="Toggle color theme"
    >
      <Sun className="sunIcon" size={15} />
      <Moon className="moonIcon" size={15} />
    </button>
  );
}
