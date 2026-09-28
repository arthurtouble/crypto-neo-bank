"use client";

// Stands in for @privy-io/react-auth/ui in end-to-end tests: Privy's modal for
// changing the email, which links the address in "aura-e2e-link-email".
import { linkEmailFlow } from "./privy-react-fake";

export const useUpdateEmail = () => ({ update: () => void linkEmailFlow({}, "exited_update_flow") });
