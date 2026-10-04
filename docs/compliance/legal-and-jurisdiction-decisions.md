---
title: Legal and jurisdiction decision register
description: Open and approved entity, geography, product, privacy, and regulatory decisions.
---

Appearing here doesn't approve a row. Before enabling the related feature, record the decision, date, accountable person, counsel/provider evidence, and review date.

| Decision | Current state | Required evidence |
|---|---|---|
| Parent and operating entity | Open | Tax, governance, liability, banking/provider eligibility, and substance advice |
| Customer contracting entity | Open | Terms party aligned with actual service and provider agreements |
| Initial countries | Open | Provider country matrix plus local product/marketing review |
| Excluded countries/persons | Sanctioned places blocked at the edge (30 September 2026, owner). Other exclusions open | Counsel review of the list; provider screening for persons. See [blocked places](#blocked-places) |
| Perps and Predictions availability | Each venue's own list applied (3 October 2026, owner); see [provider places](#provider-places) | Counsel review of Aura's role as the interface that sends the orders |
| Aura role for self-controlled wallet/DeFi interface | Open | Counsel characterization and activity-by-activity licensing analysis |
| KYC/fiat/card allocation | Open | Signed provider agreement and the [responsibility matrix](compliance-responsibility-matrix.md) |
| Tokenized assets | Enabled (2 October 2026, owner): Coinbase tokenized stocks and Tether Gold, for everyone outside the [blocked places](#blocked-places). Buying stock tokens is refused from the US and the UK (3 October 2026, owner), following Coinbase's Regulation S offer; see [provider places](#provider-places) | Issuer, venue, distribution, transfer restriction, and country review |
| Membership/rewards | Cut | None now. Card cashback, if it returns as its own feature, needs vendor contracts, tax/consumer terms, and funding |
| "Bank", "account", "deposit", insurance, and yield language | Restricted | Approved copy library reflecting the exact legal product |
| Privacy roles and data transfers | Open | Privacy notice, DPA, subprocessors, residency, and transfer mechanism |
| Retention/deletion schedule | Open | Category schedule satisfying security, complaints, and legal duties |
| Complaints and ombudsman/regulator path | Open | Jurisdiction/provider-specific procedure and published contact |

## Blocked places

On 30 September 2026 the owner chose to block the places under comprehensive sanctions: Cuba, Iran, North Korea, Syria, and the Crimea (with Sevastopol), Donetsk, and Luhansk regions of Ukraine. The list is in `apps/web/src/lib/legal/places.ts`.

- The web Worker (`apps/web/worker/index.ts`) checks every request against Cloudflare's geolocation of the connecting IP: the `CF-IPCountry` header for the country and `request.cf.regionCode` for the region.
- From a blocked place, the app (`/app`), the API (`/api`), and payment pages (`/pay`) answer 451. Pages show "Aura isn't available where you are" (`/unavailable`); the API returns `place_unavailable`. The health probe, signed provider webhooks, the landing page, and the docs (including legal pages) stay open.
- Each refusal is logged as `edge.place_blocked` with the country, region, and path, not the IP address.
- It is one control, not proof of residence: a VPN gets around it. The terms exclude sanctioned people and places, and partners screen the people they onboard.
- To add a place, add its country code, or country and ISO 3166-2 region code, to `places.ts` in a reviewed change, and record the decision here.

## Provider places

On 3 October 2026 the owner chose to apply each provider's own list of places for the features where Aura's server sends the order, so the provider can't see the customer's location: Perps (Hyperliquid), Predictions (Polymarket), and buying stock tokens (Coinbase). The lists are in `apps/web/src/lib/legal/places.ts`.

| Feature | Provider's rule | Refused from |
|---|---|---|
| Perps | Hyperliquid's terms of use restrict US and Ontario persons | The United States and its territories; Ontario |
| Predictions | Polymarket's [geographic restrictions](https://docs.polymarket.com/api-reference/geoblock), which builders must apply | Every place Polymarket makes close-only on its site or API: the United States and its territories, the United Kingdom, France, Germany, Italy, Belgium, the Netherlands, Ireland, Poland, Slovakia, Australia, New Zealand, Singapore, Japan, South Korea, Taiwan, Thailand, Brazil, Russia, Belarus, and others; Alberta, British Columbia, Ontario, and Quebec. Aura also adds the United Arab Emirates (owner, 4 October 2026): betting is unlawful there, and Aura's founders and development company are based there |
| Buying stock tokens | Coinbase offers them under Regulation S, not to the US or the UK | The United States and its territories; the United Kingdom |

- Only new things are refused (setup, adding money, opening or adding to a position, buying), with 451 `place_restricted` and a message saying what still works. Selling, closing, cancelling, redeeming, and withdrawing always work, so nobody's money is stuck.
- It's the same control as the sanctions block: Cloudflare's geolocation of the request, so a VPN gets around it. Each provider's terms still bind the customer.
- Aura can add a place to a provider's list on its own, as it did for the United Arab Emirates in Predictions, never remove one.
- When a provider changes its list, change `places.ts` in a reviewed change and update this table.

## Offshore incorporation

An offshore entity is neither necessary nor sufficient for a lawful product. It may suit governance, investment funds, token structures, or tax, but it doesn't remove rules in the countries where customers are solicited or served. Choose the entity only after mapping actual activities, founders, staff, customers, providers, banking access, tax residence, and regulatory perimeter. Provider approval and operational credibility may favor a jurisdiction with real substance and clear supervision over a nominal offshore structure.
