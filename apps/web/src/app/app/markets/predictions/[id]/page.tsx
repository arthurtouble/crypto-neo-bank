import { redirect } from "next/navigation";

/** The old address of a prediction market's page, with its query (such as `?outcome=1`) kept. */
export default async function Page({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) for (const item of [value].flat()) if (item !== undefined) query.append(key, item);
  const search = query.toString();
  redirect(`/app/predictions/${encodeURIComponent((await params).id)}${search ? `?${search}` : ""}`);
}
