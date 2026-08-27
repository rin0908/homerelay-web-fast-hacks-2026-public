# Neo4j optional integration

## Purpose

Neo4j represents the relationship graph between a HomeRelay household, its
invited family/relative/helper members, confirmed handoffs, assigned responders,
and purchase actions. It is an optional, non-blocking projection of authoritative
Supabase state; Supabase remains the source of truth.

The adapter never sends photos, audio, display names, handoff text, or needed-item
names. Needed-item concepts are represented by a SHA-256 fingerprint scoped to
the authenticated household. Every node carrying application data includes the
session-derived `householdId`.

## Graph model

- `HomeRelayMember -[:MEMBER_OF]-> HomeRelayHousehold`
- `HomeRelayMember -[:AUTHORED]-> HomeRelayHandoff`
- `HomeRelayHandoff -[:BELONGS_TO]-> HomeRelayHousehold`
- `HomeRelayMember -[:HANDOFF_ACTION]-> HomeRelayHandoff`
- `HomeRelayMember -[:ASSIGNED_TO]-> HomeRelayHandoff`
- `HomeRelayHandoff -[:NEEDS]-> HomeRelayNeededItem`
- `HomeRelayNeededItem -[:INSTANCE_OF]-> HomeRelayItemConcept`
- `HomeRelayMember -[:PURCHASE_ASSIGNEE]-> HomeRelayNeededItem`
- `HomeRelayMember -[:PURCHASE_ACTION]-> HomeRelayNeededItem`

All Cypher values are provided through Query API parameters. Event keys and item
concepts are deterministic hashes, so retries merge instead of duplicating the
same relationship. Status ranks are monotonic so delayed background events do
not regress `done` or `purchased` state.

## Server-only configuration

Set these only in the server environment, never with a `NEXT_PUBLIC_` prefix:

```dotenv
HOMERELAY_DEMO_MODE=false
HOMERELAY_DATA_MODE=supabase
NEO4J_URI=neo4j+s://your-home-relay-instance.databases.neo4j.io
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=
NEO4J_DATABASE=neo4j
NEO4J_TIMEOUT_MS=4000
```

`NEO4J_URI` accepts an Aura `neo4j+s://` connection URI and uses the same host's
TLS Query API. HTTPS is required except for an explicit loopback development
server. Missing or invalid configuration disables the adapter before any network
request.

## Verification

Bootstrap the HomeRelay-only labels before the first live write:

```powershell
npm run neo4j:bootstrap
```

The bootstrap uses a fixed, parameter-free allowlist of five idempotent
`CREATE CONSTRAINT ... IF NOT EXISTS` statements. It creates uniqueness
constraints for household IDs and household-scoped member, handoff, needed-item,
and item-concept identities, then reads back the exact constraint names. It
never accepts a Cypher statement from an environment variable or request.

Then run the synthetic write/read verifier:

```powershell
npm run verify:neo4j
```

Without credentials both commands exit successfully with `SKIP / 未接続` and
make no request. With HomeRelay-only credentials the verifier writes a uniquely
identified synthetic graph, reads back family/relative/helper, handoff
assignment, and purchase relations, then removes only that run's exact synthetic
household. Query API requests reject redirects so the Basic authorization header
cannot be forwarded to another endpoint.
Passing local unit tests prove parameterization and fallback behavior, but do not
count as a live Neo4j connection.

Official references:

- [Neo4j Query API](https://neo4j.com/docs/query-api/current/query/)
- [Neo4j Query API authentication](https://neo4j.com/docs/query-api/current/authentication-authorization/)
- [Neo4j uniqueness constraints](https://neo4j.com/docs/cypher-manual/current/schema/constraints/create-constraints/)
- [Connect to an Aura instance](https://neo4j.com/docs/aura/getting-started/connect-instance/)
