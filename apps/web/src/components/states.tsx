import { LoaderCircle } from "lucide-react";
import Link from "next/link";

/**
 * Something loading in place: a spinner and what is being read. `children`
 * can carry a bolder title and a detail line.
 */
export function LoadingState({ label, children }: { label?: React.ReactNode; children?: React.ReactNode }) {
  return <div className="appState" role="status"><LoaderCircle className="spin" aria-hidden="true" />{children ?? label}</div>;
}

/** The whole screen loading, before the app can draw anything (shell.css, appLoading). */
export function LoadingScreen({ label }: { label: string }) {
  return <div className="appLoading" role="status"><LoaderCircle className="spin" aria-hidden="true" /><p>{label}</p></div>;
}

type NoticeProps = {
  /** info (accent-soft), warning, or error. */
  tone?: "info" | "warning" | "error";
  /** "alert" for a failure, "status" for a live update; none for a static note. */
  role?: "alert" | "status";
  /** Adds "Try again" after the text. */
  onRetry?: () => void;
  className?: string;
  children: React.ReactNode;
} & { "data-testid"?: string };

/** A note in place of what couldn't be read or done, or beside a decision: a soft status background and short text. */
export function Notice({ tone = "info", role, onRetry, className, children, ...rest }: NoticeProps) {
  const toneClass = tone === "warning" ? " mxNoteWarning" : tone === "error" ? " mxNoteError" : "";
  return <p className={`mxNote${toneClass}${className ? ` ${className}` : ""}`} role={role} data-testid={rest["data-testid"]}>
    {typeof children === "string" ? <SupportText text={children} /> : children}{onRetry && <>{" "}<button type="button" className="appTextButton mxInlineButton" onClick={onRetry}>Try again</button></>}
  </p>;
}

/** A value that couldn't be read: the word, in the warning colour. Never the last value, never zero. */
export function Unavailable({ children = "Unavailable" }: { children?: React.ReactNode }) {
  return <span className="appUnavailable">{children}</span>;
}

/**
 * Text that may tell the customer to contact support, with those words as a link to Support, so help is one
 * tap away. The words stay plain text where they're written (server errors, failure reasons, email).
 */
export function SupportText({ text }: { text: string }) {
  const match = /contact support/i.exec(text);
  if (!match) return text;
  return <>{text.slice(0, match.index)}<Link className="appTextButton mxInlineButton" href="/app/support">{match[0]}</Link>{text.slice(match.index + match[0].length)}</>;
}
