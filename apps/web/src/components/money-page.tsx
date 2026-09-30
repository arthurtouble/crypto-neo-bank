import { useId } from "react";
import { GuestBanner } from "./guest-banner";

type MoneyPageProps = {
  title: string;
  /** Show the guest banner: signed out (example data), or while sign-in is still loading. */
  guest: boolean;
  onSignIn: () => void;
  ready: boolean;
  /** The area's own class beside mxPage: "erPage", "cdPage". */
  className?: string;
  children: React.ReactNode;
};

/** A money section's page: the guest banner when it applies, the title, then the section (money.css, mx parts). */
export function MoneyPage({ title, guest, onSignIn, ready, className, children }: MoneyPageProps) {
  return <div className={`mxPage${className ? ` ${className}` : ""}`}>
    {guest && <GuestBanner onSignIn={onSignIn} ready={ready} />}
    <header className="mxHead"><h1>{title}</h1></header>
    {children}
  </div>;
}

type SignedOutPanelProps = {
  title: string;
  /** Names the panel instead of its title, where a test or screen reader expects that name ("Swap form"). */
  ariaLabel?: string;
  /** The button: "Sign in to send". */
  action: string;
  onSignIn: () => void;
  children: React.ReactNode;
};

/** What a guest sees in place of a money form: what it does, and one way to sign in. */
export function SignedOutPanel({ title, ariaLabel, action, onSignIn, children }: SignedOutPanelProps) {
  const id = useId();
  return <section className="mxPanel" aria-label={ariaLabel} aria-labelledby={ariaLabel ? undefined : id}>
    <div className="mxPanelHead"><h2 id={id}>{title}</h2><p>{children}</p></div>
    <button type="button" className="appButton appButtonPrimary appButtonLarge" onClick={onSignIn}>{action}</button>
  </section>;
}
