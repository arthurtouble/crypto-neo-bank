/**
 * When an open action counts as stuck, shared by the web app's operator views
 * and the events Worker's reconciliation: a submitted action after 15 minutes
 * without a settled receipt, and a cross-network one after 2 hours still settling.
 * Both are measured from submission.
 */
export const STUCK_SUBMITTED_MS = 15 * 60_000;
export const STUCK_SETTLING_MS = 2 * 60 * 60_000;
