# Provider Activation Blueprint

This is the internal handoff for turning Aurel's prepared product surfaces into contracted services. Product UI remains provider-neutral; adapters, operations, and contracts name the underlying provider.

## Operating rule

Aurel stores provider references, projections, preferences, and support metadata. It does not treat its database as the authority for balances, account details, transfer settlement, card status, rewards, insurance cover, or benefit fulfilment. Every adapter must support fresh reads, signed webhooks, idempotent commands, and reconciliation against its source.

Preview mode may show complete workflows and eligibility gates, but never fabricated account numbers, cards, cover, rewards, or completed transfers.

## Proposed providers

| Capability | Primary candidate | Alternate | Prepared product surface | Activation dependency |
| --- | --- | --- | --- | --- |
| USD accounts, ACH, wire, FedNow, on/off-ramp | Bridge | Rain or Noah, subject to country and product scope | Transfers, account details, recipients, transfer review | Platform approval, customer mapping, KYC link, API key, webhooks |
| Wallet login and signing | Privy | — | Aurel Account, receive, send, recovery, export | Already integrated; production configuration and monitoring |
| Cross-network USDC | LI.FI | Provider-native routing when contracted | Move Between Networks | Already integrated; route monitoring and supported-pair policy |
| Card issuing | Bridge card program / issuing partner | Rain | Card, controls, wallet provisioning | Issuer approval, cardholder KYC, program terms, disputes, auth webhooks |
| Merchant rewards | Kard | Card-network rewards provider | Offers, reward history, activation | Program agreement, customer enrolment, transaction-match webhook |
| Lifestyle concierge | Ten Lifestyle Group | Regional concierge partner | Travel, dining, event requests | Service agreement, member provisioning, request/status API or hosted module |
| Airport lounges | Collinson LoungeKey Pass | Priority Pass commercial program | Lounge discovery and passes | Commercial agreement, member/pass issuance, billing and support rules |
| eSIM | Gigs | 1GLOBAL | Global Data catalogue and activation | Project credentials, plan catalogue, subscription lifecycle, credential handling |
| Travel insurance | nib travel insurance | Regional embedded-insurance partner | Quote, eligibility, documents, claims handoff | Distributor approval, licensed coverage model, quote/booking API, disclosures |

## Bridge activation

### Customer and compliance

1. Create or link a Bridge customer only after Aurel has collected the minimum permitted onboarding data and terms acceptance.
2. Store the Bridge customer ID against the Privy subject; never infer customer identity from an email alone.
3. Launch the provider-hosted verification flow.
4. Read missing requirements and requests for information. Show only the next customer action.
5. Enable banking and card actions only after the applicable capability is approved—not merely because a general customer object exists.

### Virtual account

Create a USD virtual account with an explicit destination configuration. Sync reusable ACH/wire instructions from Bridge. Mask instructions outside the authenticated detail view. Incoming-payment webhooks update Aurel's projection; scheduled reconciliation re-reads the provider.

The UI is already modeled around `setup_required`, `pending`, and `active`. Replace the preview account response with the Bridge adapter after adding the subject-to-customer mapping and secrets.

### Transfers

The command path is: validate customer capability → validate recipient → show amount, fee, timing, and funding source → require step-up when policy says so → submit with an idempotency key → store the provider transfer ID → update from webhooks → reconcile until terminal.

Never mark a transfer complete from the initial API response. Support returns, refunds, review holds, and additional-information requests.

### Liquidation and routing addresses

Provider-created liquidation addresses may accept configured assets and convert them to USD. They are not a universal deposit address. The app must display the exact asset and network returned by the provider and reject unsupported pairs.

## Benefits activation

All benefit adapters use the same customer-facing states: `setup_required`, `available`, `used`, `expired`, and `action_required`. Provider-specific states remain internal.

- Kard: enroll the customer, issue an embedded WebView token for offer discovery, ingest matched-transaction webhooks, and read reward history from Kard.
- Ten: provision eligible members and route travel, dining, entertainment, offers, and event requests through contracted API or hosted modules.
- LoungeKey Pass: issue a pass only after entitlement reservation; record provider pass ID, expiry, guest terms, and cost.
- Gigs: create a user/subscription, provision an eSIM, and treat activation URLs and QR credentials as secrets. Never log or cache installation credentials in analytics.
- nib: request a quote with exact trip and residency facts, show provider disclosures, and hand booking and policy documents to the licensed provider.

## Configuration

Production secrets belong in Cloudflare secret bindings, not source control:

```text
BRIDGE_API_KEY
BRIDGE_WEBHOOK_SECRET
KARD_API_KEY
KARD_WEBHOOK_SECRET
TEN_API_KEY
LOUNGE_PROVIDER_API_KEY
GIGS_API_KEY
NIB_API_KEY
```

Each service also needs an explicit mode (`preview` or `live`), approved countries, timeout, retry ceiling, circuit breaker, and support owner. Live mode must fail closed when credentials, mappings, or customer approval are missing.

## Go-live evidence

- Signed contract, pricing schedule, countries, prohibited uses, and termination/export terms.
- Sandbox happy path and failure fixtures.
- Authentication, secret rotation, webhook signature, replay, and idempotency tests.
- Customer support runbooks for pending, rejected, returned, disputed, expired, and provider-outage states.
- Reconciliation reports proving Aurel projections converge to the provider.
- Legal review of product copy, fees, privacy, complaints, disclosures, and benefit terms.
- Production canary customer and kill switch for each capability.
