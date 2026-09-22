import Link from "next/link";
import { ArrowDownToLine, ArrowUpFromLine, Plus, Repeat2 } from "lucide-react";

export function DashboardActions() {
  return <div className="introActions"><Link className="button primary" href="/app/transfers"><Plus size={15} /> Add Money</Link><Link className="button secondary" href="/app/assets"><ArrowUpFromLine size={15} /> Send</Link><Link className="button secondary" href="/app/exchange"><Repeat2 size={15} /> Swap</Link><Link className="button secondary" href="/app/transfers"><ArrowDownToLine size={15} /> Withdraw</Link></div>;
}
