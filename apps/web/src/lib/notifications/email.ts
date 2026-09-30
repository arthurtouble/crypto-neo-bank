import type { NotificationKind } from "./store";

/**
 * Notice emails in the design system. Email clients ignore CSS variables and most stylesheets, so the values are
 * copied from apps/web/public/design-tokens.css and inlined; tests/unit/notification-email.test.ts fails if they drift.
 * One narrow column: the wordmark, a label, the title, the message, one action, and a footer. Light by default, with
 * the dark tokens for clients that honour prefers-color-scheme.
 */
export const emailTokens = {
  light: { canvas: "#f7f8fa", surface: "#ffffff", text: "#0f1115", textSecondary: "#5b6270", textTertiary: "#6c7280", line: "#e6e8ec",
    accent: "#3d3fe0", onAccent: "#ffffff", negative: "#c1372b", positive: "#0f7b52" },
  dark: { canvas: "#0b0d11", surface: "#12151b", text: "#edeff3", textSecondary: "#a3a9b5", textTertiary: "#7d8491", line: "#20242d",
    accent: "#8e90ff", onAccent: "#0b0d11", negative: "#ff7a6b", positive: "#3ecf8e" },
  radius: { sm: "6px", lg: "10px" },
  font: "Geist, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
} as const;

const labels: Record<NotificationKind, { text: string; tone: "text" | "positive" | "negative" | "accent" }> = {
  received: { text: "Money received", tone: "positive" },
  completed: { text: "Completed", tone: "text" },
  failed: { text: "Didn't go through", tone: "negative" },
  security: { text: "Security", tone: "accent" }
};

const footer = (kind: NotificationKind) => kind === "security"
  ? "Security notices are always sent, so you know about every change to your account."
  : "You can choose which transaction notices you get in Settings, under Notifications. Security notices are always sent.";

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

/** The subject, plain text, and HTML for one notice. `link` is the absolute address of the page it opens. */
export function renderNoticeEmail(notice: { kind: NotificationKind; title: string; body: string }, link: string) {
  const { light: l, dark: d, radius, font } = emailTokens;
  const label = labels[notice.kind] ?? labels.completed;
  const tone = { text: [l.textSecondary, d.textSecondary], positive: [l.positive, d.positive], negative: [l.negative, d.negative], accent: [l.accent, d.accent] }[label.tone];
  const title = escapeHtml(notice.title);
  const body = escapeHtml(notice.body);
  const href = escapeHtml(link);
  const text = `${label.text}\n\n${notice.title}\n\n${notice.body}\n\nOpen in Aura: ${link}\n\n${footer(notice.kind)}`;
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${title}</title>
<style>
  @media (prefers-color-scheme: dark) {
    .canvas { background: ${d.canvas} !important; }
    .card { background: ${d.surface} !important; border-color: ${d.line} !important; }
    .text { color: ${d.text} !important; }
    .secondary { color: ${d.textSecondary} !important; }
    .tertiary { color: ${d.textTertiary} !important; }
    .label { color: ${tone[1]} !important; }
    .button { background: ${d.accent} !important; color: ${d.onAccent} !important; }
    .rule { border-color: ${d.line} !important; }
  }
</style>
</head>
<body class="canvas" style="margin:0;padding:0;background:${l.canvas};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${body}</div>
<table role="presentation" class="canvas" width="100%" cellpadding="0" cellspacing="0" style="background:${l.canvas};">
<tr><td align="center" style="padding:32px 16px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">
    <tr><td class="text" style="padding:0 4px 16px;font:600 17px/24px ${font};color:${l.text};letter-spacing:-0.01em;">Aura</td></tr>
    <tr><td class="card" style="background:${l.surface};border:1px solid ${l.line};border-radius:${radius.lg};padding:32px;">
      <p class="label" style="margin:0 0 8px;font:500 12px/16px ${font};color:${tone[0]};">${label.text}</p>
      <h1 class="text" style="margin:0 0 12px;font:600 22px/28px ${font};color:${l.text};letter-spacing:-0.02em;">${title}</h1>
      <p class="secondary" style="margin:0 0 24px;font:400 15px/22px ${font};color:${l.textSecondary};">${body}</p>
      <a class="button" href="${href}" style="display:inline-block;padding:12px 20px;border-radius:${radius.sm};background:${l.accent};color:${l.onAccent};font:500 14px/20px ${font};text-decoration:none;">Open in Aura</a>
    </td></tr>
    <tr><td class="tertiary" style="padding:16px 4px 0;font:400 12px/16px ${font};color:${l.textTertiary};">${escapeHtml(footer(notice.kind))}</td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;
  return { subject: notice.title, text, html };
}
