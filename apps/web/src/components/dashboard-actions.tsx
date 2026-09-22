import Link from "next/link";
import { Landmark, Plus, Send } from "lucide-react";

export function DashboardActions() {
  return <div className="introActions"><Link className="button secondary" href="/app/transfers"><Landmark size={15} /> Transfer</Link><Link className="button secondary" href="/app/assets"><Send size={15} /> Send</Link><Link className="button primary" href="/app/assets"><Plus size={15} /> Receive</Link></div>;
}
