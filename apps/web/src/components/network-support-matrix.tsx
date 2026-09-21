import { CheckCircle2, Clock3, Fuel, ShieldAlert } from "lucide-react";

const networks = [
  { name: "Base", role: "Home account", assets: "USDC · ETH · WETH", arrival: "Usually under 1 min", gas: "ETH on Base", level: "Full" },
  { name: "Ethereum", role: "USDC route", assets: "Native USDC", arrival: "Typically 5–20 min", gas: "ETH", level: "Route" },
  { name: "Arbitrum", role: "USDC route", assets: "Native USDC", arrival: "Typically 2–10 min", gas: "ETH on Arbitrum", level: "Route" },
  { name: "Optimism", role: "USDC route", assets: "Native USDC", arrival: "Typically 2–10 min", gas: "ETH on Optimism", level: "Route" },
  { name: "Polygon", role: "USDC route", assets: "Native USDC", arrival: "Typically 5–20 min", gas: "POL", level: "Route" }
];

export function NetworkSupportMatrix() {
  return <section className="panel supportMatrix"><div className="panelHeading"><div><p className="eyebrow">TESTED SUPPORT</p><h2>Know the route before you send</h2><p className="sourceCaption">Base is the account network. Other networks are supported only for quoted USDC routes.</p></div><ShieldAlert size={19} /></div>
    <div className="supportRows"><div className="supportHead"><span>Network</span><span>Supported asset</span><span>Typical timing</span><span>Gas</span><span>Mode</span></div>{networks.map((network) => <div key={network.name}><span><strong>{network.name}</strong><small>{network.role}</small></span><span>{network.assets}</span><span><Clock3 size={13} /> {network.arrival}</span><span><Fuel size={13} /> {network.gas}</span><span className={`supportLevel ${network.level === "Full" ? "full" : ""}`}><CheckCircle2 size={12} /> {network.level}</span></div>)}</div>
    <p className="authorityFootnote">A supported route can still be temporarily unavailable because of liquidity, relayer, network, or quote conditions. Do not send tokens that are not listed.</p>
  </section>;
}
