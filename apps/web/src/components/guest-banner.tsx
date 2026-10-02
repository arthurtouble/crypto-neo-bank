/** Guests see every section with fictional data; this says so, with the one way in. Privy's sign-in creates the account. */
export function GuestBanner({ onSignIn, ready = true }: { onSignIn: () => void; ready?: boolean }) {
  return <div className="appGuestBanner" role="note">
    <p><strong>Example data</strong><span>Explore Aura before creating an account. Values and activity shown here are fictional.</span></p>
    <button type="button" className="appButton appButtonPrimary" onClick={onSignIn} disabled={!ready}>Create account or sign in</button>
  </div>;
}
