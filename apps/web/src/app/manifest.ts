import type { MetadataRoute } from "next";
import { themeColors } from "@/lib/site/seo";

/**
 * The web app manifest, so Aura can be added to a home screen and opens on its own. On iPhone and iPad that's what
 * lets Aura send push notices (components/notification-preferences.tsx). Icons are PNGs made from app/icon.svg; the
 * maskable one fills the square so Android can crop it to its own shape.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Aura",
    short_name: "Aura",
    description: "Hold stablecoins, crypto, tokenized stocks, and gold, then send, swap, and earn.",
    id: "/app",
    start_url: "/app",
    scope: "/",
    display: "standalone",
    background_color: themeColors.light,
    theme_color: themeColors.light,
    categories: ["finance"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }
    ]
  };
}
