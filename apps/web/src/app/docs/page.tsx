import { redirect } from "next/navigation";

export default function DocumentationRedirect() {
  redirect(process.env.NEXT_PUBLIC_DOCS_URL ?? "https://aurel-docs.aurel-events.workers.dev");
}
