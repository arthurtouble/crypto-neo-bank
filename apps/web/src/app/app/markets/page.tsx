import { redirect } from "next/navigation";

/** Markets split into Perps and Predictions on 3 October 2026. Old links open the matching section. */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  redirect((await searchParams).view === "predictions" ? "/app/predictions" : "/app/perps");
}
