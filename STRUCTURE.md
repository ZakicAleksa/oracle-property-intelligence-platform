# Project Structure

A map of the codebase for anyone coming from a .NET background. Analogies below are approximate,
meant to build intuition, not exact equivalences.

## Top-level layout

```
oracle-property-intelligence-platform/
├── README.md              Assignment spec — source of truth for scope/acceptance criteria. Don't edit.
├── CLAUDE.md               Process/style guidance for AI-assisted work in this repo.
├── ENTITY-MODEL.md         Canonical data model: which entities are reused vs. genuinely new.
├── PLAN.md                 Phased build plan, with what's done/pending in each phase.
├── STRUCTURE.md            This file.
├── AGENTS.md               Next.js's own warning: this Next version may differ from AI training data.
│
├── package.json            Like a .csproj — dependencies + named scripts (dev/build/test/lint/db:*).
├── tsconfig.json           Like a .editorconfig + compiler settings combined — strict typing rules.
├── eslint.config.mjs       Like Roslyn analyzers / StyleCop — enforced code-quality rules.
├── .prettierrc.json        Like `dotnet format` config — auto-formatting rules.
├── vitest.config.ts        Like an xUnit/NUnit runner config — test runner setup.
├── drizzle.config.ts       Tells the DB migration tool where the schema lives and how to connect.
├── next.config.ts          Framework-level config (build behavior, image domains, etc.)
├── .env.example            Documents required environment variables (never commit the real .env).
│
├── src/                    All application code (see below).
├── scripts/                Offline data-loading pipeline — NOT part of the deployed app (see below).
└── public/                 Static files served as-is (images, icons) — like wwwroot in ASP.NET.
```

## `src/` in detail

```
src/
├── app/                              Next.js "App Router" — file path IS the URL route.
│   ├── layout.tsx                    Shared shell around every page (like a Razor _Layout.cshtml).
│   ├── page.tsx                      The page at "/" (home page).
│   ├── providers.tsx                 Client-side context providers (React Query + tRPC client).
│   ├── globals.css                   Global styles (Tailwind entrypoint).
│   └── api/
│       └── trpc/[trpc]/route.ts      The ONE HTTP endpoint all tRPC calls go through.
│                                     "[trpc]" is a dynamic segment — like an ASP.NET route
│                                     parameter, e.g. {**catchAll} in a minimal API route.
│
├── server/                           Server-only code — never bundled into the browser.
│   ├── trpc.ts                       tRPC setup: creates `router` and `publicProcedure` builders.
│   ├── routers/
│   │   ├── _app.ts                   The root router — like Program.cs mapping all endpoints,
│   │   │                            except each "procedure" is fully typed end-to-end.
│   │   └── _app.test.ts              Vitest test calling the router directly (no HTTP needed).
│   ├── db.ts                         Creates the Drizzle DB client (like a DbContext instance).
│   ├── schema/
│   │   ├── index.ts                  Barrel file: re-exports the adopted schema + our extensions.
│   │   └── extensions.ts             OUR new tables: `projects`, `tenants`, `public_records`
│   │                                 (+ `project_permits` join table).
│   │                                 Everything else in the DB is adopted, not hand-rolled — see
│   │                                 ENTITY-MODEL.md for which entities are "Reuse" vs "New".
│   └── elephant-query-db/            Copied wholesale from the company's public schema repo
│       ├── schema/                   (elephant-xyz/elephant-query-db). Like vendoring a NuGet
│       │   ├── core.ts               package's source because it isn't published to npm.
│       │   ├── appraisal.ts          Each file is a group of Drizzle table definitions — think
│       │   ├── permits.ts            EF Core entity classes, but defined as plain objects instead
│       │   ├── bbb.ts                 of classes with attributes.
│       │   ├── sunbiz.ts
│       │   ├── shared.ts             Shared column helpers (e.g. provenance columns every table
│       │   │                        gets — sourceSystem, loadedAt, etc.)
│       │   ├── views.ts              Read-optimized SQL views (joins pre-built for common reads).
│       │   └── index.ts              Barrel file re-exporting everything above.
│       └── types.ts                  Inferred TypeScript types for the schema.
│
├── lib/
│   └── trpc.ts                       The typed tRPC client hook factory used by React components.
│
└── test/
    └── server-only-stub.ts           Test-only shim (see comment in the file for why it exists).
```

## How a request actually flows

For the one working feature right now (the `health` check), tracing it end-to-end:

1. `src/app/page.tsx` (a React **Client Component** — runs in the browser) calls
   `trpc.health.useQuery()`.
2. That's powered by `src/lib/trpc.ts` + `src/app/providers.tsx`, which wire up a React Query
   client and point it at `/api/trpc`.
3. The browser calls `GET /api/trpc/health`. Next.js routes that to
   `src/app/api/trpc/[trpc]/route.ts` — this is a **Route Handler**, Next's equivalent of a
   minimal API endpoint (`app.MapGet(...)` in ASP.NET).
4. That file hands the request to tRPC's `fetchRequestHandler`, which looks up the matching
   procedure in `src/server/routers/_app.ts` (`appRouter.health`) and runs it.
5. The procedure is defined in `src/server/trpc.ts` + `_app.ts` — no controller class, no
   attribute routing; the router object itself *is* the route table, and its shape is exported
   as the `AppRouter` type so the client gets full autocomplete/type-checking for free (this is
   tRPC's whole pitch: no separate OpenAPI/Swagger contract to keep in sync).

Once the DB is wired up (Phase 3), a typical read will instead go:
browser → tRPC procedure → `src/server/db.ts` (Drizzle client) → a table from
`src/server/schema/index.ts` → Neon Postgres → typed rows back to the browser, with no manual
JSON (de)serialization or DTO mapping step anywhere in that chain.

## `scripts/` — the offline ingestion pipeline

Not part of the deployed Next.js app at all — a separate set of standalone Node scripts, run by hand (or eventually a cron job), that populate the database the app then reads from. Kept in its own `scripts/package.json` with `"type": "module"`, since one dependency (`hyparquet`, the Parquet reader) is ESM-only and Next.js's own package.json isn't. `src/` also has a `type: module` marker for the same reason — see `PLAN.md` Phase 3 for the full story of why.

```
scripts/
├── package.json                      Scopes "type": "module" to this folder only.
├── types/
│   └── parse-address.d.ts            Hand-written type declarations — the `parse-address`
│                                     npm package ships no types of its own.
└── ingest/
    ├── db.ts                         A second Drizzle client, deliberately without the
    │                                 "server-only" import guard `src/server/db.ts` has —
    │                                 these scripts run outside Next.js entirely, so that
    │                                 guard doesn't apply and would just get in the way.
    ├── address.ts                    Parses Oracle's combined street string (e.g.
    │                                 "4815 SHORE LANE") into the schema's granular columns
    │                                 (number/name/suffix/etc.) plus a normalized key + hash
    │                                 for reliable address matching later.
    ├── select-subset.ts              Picks which properties actually get loaded — see below.
    ├── backbone.ts                   Reads the Parquet, transforms each row, upserts into
    │                                 parcels/addresses/properties/ownerships/sales_histories/
    │                                 public_records. Idempotent (safe to re-run) via
    │                                 `onConflictDoUpdate` keyed by each table's
    │                                 `(sourceSystem, sourceRecordKey)` pair.
    ├── vacuum.ts                     Reclaims storage after bulk upserts — Postgres writes a
    │                                 new row version on every UPDATE rather than updating in
    │                                 place, so re-running the idempotent scripts costs real
    │                                 storage even with zero new data. Run after any bulk re-run.
    ├── fetch-property.ts             Fetches one property's full consolidated JSON straight
    │                                 from IPFS by CID (`property_cid` from the Parquet) —
    │                                 same content the elephant MCP server returns, no MCP
    │                                 dependency needed for enrichment.
    ├── contractor.ts                 Extracts phone/email/license from Oracle's unparsed
    │                                 contractor contact strings and resolves durable
    │                                 `companies` identity via a sorted-token match key (order-
    │                                 independent — same contractor listed "Person Company" on
    │                                 one contact and "Company Person" on another still merges).
    ├── permits.ts                    Loads one property's permits[] into property_improvements
    │                                 + all 5 child tables, resolving contractor identity via
    │                                 contractor.ts.
    └── enrich.ts                     Orchestrator: for a bounded subset of the backbone with
                                      permit/Sunbiz/BBB signal, fetches each property and loads
                                      it. Permits done; Sunbiz/BBB follow the same pattern.
```

**Why `select-subset.ts` exists:** the full Lee County dataset (511,695 properties) doesn't fit in Neon's free-tier storage cap — confirmed by actually hitting the limit, not just estimating. Taking "the first N rows" turned out to be geographically skewed too (the Parquet is physically sorted by parcel identifier, not shuffled). `select-subset.ts` instead groups by city, gives every city a proportional share (with a floor so small cities aren't zeroed out), and prioritizes properties with permit/Sunbiz/BBB signal within each city's share — so the loaded subset is both geographically representative and rich in the kind of data the RAG/exploration features actually need. Its output (`backbone-subset.json`, a plain array of property IDs) is git-ignored — it's a regenerable pipeline artifact, not something worth version-controlling.

## Two kinds of code in `src/server/`

Worth keeping straight, since it affects how changes should be made:

- **`elephant-query-db/`** — adopted as-is from the company's public repo. Treat it like a vendored
  dependency: don't hand-edit table definitions here casually, since re-syncing from upstream later
  gets harder the more it drifts. (One exception already made: import paths were stripped of `.js`
  suffixes so Turbopack could resolve them — see `PLAN.md` Phase 2 notes.)
- **`schema/extensions.ts`** — ours. This is where `Tenant`, `Project`, and `Public Record` live,
  the three entities `ENTITY-MODEL.md` confirms don't exist anywhere upstream. Any new table this
  project needs goes here, not into `elephant-query-db/`.
