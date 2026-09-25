"use client";

import { usePrivy } from "@privy-io/react-auth";
import { MessageSquareText } from "lucide-react";
import { FormEvent, useState } from "react";
import { usePathname } from "next/navigation";

export function FeedbackPanel() {
  const { getAccessToken } = usePrivy();
  const pathname = usePathname();
  const [sentiment, setSentiment] = useState<"positive" | "neutral" | "negative">("neutral");
  const [category, setCategory] = useState("usability");
  const [message, setMessage] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  async function submit(event: FormEvent) {
    event.preventDefault(); setState("sending");
    try {
      const token = await getAccessToken();
      const response = await fetch("/api/feedback", { method: "POST", headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" }, body: JSON.stringify({ surface: pathname, sentiment, category, message }) });
      if (!response.ok) throw new Error();
      setMessage(""); setState("sent");
    } catch { setState("error"); }
  }
  return <section className="panel feedbackPanel"><div className="panelHeading"><div><p className="eyebrow">FEEDBACK</p><h2>Tell us what got in the way</h2><p>Short, specific feedback helps us fix the product before adding more features.</p></div><MessageSquareText size={19} /></div><form onSubmit={(event) => void submit(event)}><div className="feedbackChoices" role="group" aria-label="Overall experience"><button type="button" className={sentiment === "positive" ? "selected" : ""} onClick={() => setSentiment("positive")}>Worked well</button><button type="button" className={sentiment === "neutral" ? "selected" : ""} onClick={() => setSentiment("neutral")}>Mixed</button><button type="button" className={sentiment === "negative" ? "selected" : ""} onClick={() => setSentiment("negative")}>Blocked me</button></div><label><span>Topic</span><select value={category} onChange={(event) => setCategory(event.target.value)}><option value="usability">Ease of use</option><option value="trust">Trust or clarity</option><option value="missing_feature">Missing feature</option><option value="bug">Something broke</option><option value="other">Other</option></select></label><label><span>What happened?</span><textarea value={message} onChange={(event) => setMessage(event.target.value)} minLength={10} maxLength={1500} placeholder="What were you trying to do, and what would have made it clearer?" required /></label><button className="button secondary" disabled={state === "sending"}>{state === "sending" ? "Sending…" : "Send feedback"}</button>{state === "sent" && <p className="formSuccess" role="status">Thank you. Your feedback is in the review queue.</p>}{state === "error" && <p className="formError" role="alert">Feedback could not be sent. Please try again.</p>}</form></section>;
}

