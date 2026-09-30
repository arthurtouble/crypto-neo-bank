import { permanentRedirect } from "next/navigation";

/** The waitlist is gone for good: anyone can try the app. */
export default function FormerWaitlistPage() {
  permanentRedirect("/app");
}
