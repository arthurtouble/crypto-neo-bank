import { redirect } from "next/navigation";

/** The old address of a perp's page. A stock perp's coin stays encoded ("xyz%3ASPCX"). */
export default async function Page({ params }: { params: Promise<{ coin: string }> }) {
  redirect(`/app/perps/${encodeURIComponent(decoded((await params).coin))}`);
}

const decoded = (value: string) => { try { return decodeURIComponent(value); } catch { return value; } };
