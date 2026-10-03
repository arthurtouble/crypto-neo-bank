/**
 * Notices a screen has already told the customer about, by key (`NotificationView.key`). The bell still lists them,
 * and email still sends them, but it doesn't raise them again as a toast in the browser where the customer just did it.
 */
const quiet = new Set<string>();

export function quietNotice(key: string) { quiet.add(key); }

export function isQuiet(key: string) { return quiet.has(key); }
