# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Project

Property intelligence platform built on Oracle's already-collected Lee County, FL public data (property/appraisal, permits, Sunbiz, BBB). `README.md` is the source of truth for scope, acceptance criteria, and demo requirements — read it before making scope decisions. `STRUCTURE.md` maps the codebase layout and request flow.

## Status

Phase 2 of `PLAN.md` done: Next.js 16 (App Router) + TypeScript strict + Tailwind + tRPC (end-to-end, verified with a real `next build` and a live `dev` round-trip) + the adopted `elephant-query-db` schema plus our `projects`/`tenants`/`public_records` extensions. Deployed and verified live at https://oracle-property-intelligence-platfo.vercel.app (manual `vercel --prod` deploys; no GitHub auto-deploy link yet).

Phase 3 in progress: Neon Postgres provisioned via the Vercel Marketplace integration (`neon-gray-door`, free tier), `DATABASE_URL` wired into both Vercel and local `.env.local` (git-ignored). Schema pushed live via `npm run db:push` — verified directly with a real query: all 55 tables exist. `pgvector` 0.8.0 enabled (`CREATE EXTENSION vector`), verified via `pg_extension`.

Backbone ingestion (`scripts/ingest/`) done and validated: 101,156 properties loaded (a stratified subset across all 47 cities, not literally all 511,695 — the free tier's 0.5GB cap turned out to only fit ~1/5 of the county; see `PLAN.md` Phase 3 for the full story and real numbers). Includes address parsing/normalization (`scripts/ingest/address.ts`). Validated directly against the DB (not just trusted): 0 stray rows, 0 duplicates, spot-checked against source data, confirmed idempotent on re-run. **Re-running the ingestion scripts costs real storage even with no new data** (Postgres MVCC — see `scripts/ingest/vacuum.ts` / `npm run db:vacuum`) — run vacuum after any bulk re-run.

Permit enrichment (`scripts/ingest/enrich.ts` + `permits.ts` + `contractor.ts` + `fetch-property.ts`) built and verified on a 10-property test batch — see `PLAN.md` Phase 3 for the real data quirks found (messy `improvementType` text, contractor identity embedded in unparsed strings) and how contractor deduplication works (sorted-token match key) plus its documented limitation (abbreviated name variants don't merge). Not yet done: scaling permit enrichment past the test batch; Sunbiz enrichment; BBB enrichment; `tenants`/`projects` derivation.

Commands: `npm run dev`, `npm run build`, `npm run start`, `npm run lint`, `npm run format` / `format:check`, `npm test`, `npm run db:generate` / `db:push` / `db:studio` / `db:vacuum` (need `DATABASE_URL` set — see `.env.example`).

## Data access — read before writing any ingestion/query code

- Confirmed access #1: the public `elephant` MCP server (IPFS-published Oracle open data, no credentials required) — per-property consolidated JSON via `getOracleProperty`, plus geo tools.
- Confirmed access #2: a full-scale Lee County Parquet export (511,695 properties, ~37 columns) is publicly downloadable over plain HTTPS from IPFS/Filebase — verified live (HTTP 200, `application/vnd.apache.parquet`, `PAR1` magic bytes). Read with `hyparquet` (pure JS — the native `duckdb` npm package crashes on this file on Windows, see `PLAN.md` Phase 3); this is the bulk-load path for Phase 3, independent of MCP tool availability. **Caution:** it's a live IPNS pointer the company's pipeline can re-publish — re-verify it resolves before depending on it in ingestion code. See `PLAN.md` Phase 3 for the URL.
- No credentials to the company's private `elephant-query-db` Neon instance — but its Drizzle schema source (upstream repo's `src/schema/*.ts`) is public on GitHub and has been copied into our own `src/server/elephant-query-db/schema/` (see `STRUCTURE.md`) for our own DB. Build assuming no live DB access unless that changes.
- The `use-elephant-mcp` docs describe `queryProperties`/`getPropertyQuerySchema` bulk-SQL MCP tools that were **not** present in our actual connected session (only 10 simpler tools — they exist on `elephant-mcp`'s `main` branch, not the `v1.7.0` tag we're pinned to). Not a blocker: the Parquet file above covers the same need without them.
- `.mcp.json` (the two public `ORACLE_*_IPNS` values) currently lives one level above this repo, at the multi-repo root. Recreate it inside this repo if it's ever cloned standalone.

## Tech stack

Next.js (App Router) + TypeScript (strict, no `any`) + tRPC + Drizzle ORM + Neon Postgres with `pgvector` + Vitest + ESLint/Prettier, deployed on Vercel.

For LLM/RAG code: **Vercel AI SDK (`ai` package) only** — never a raw provider SDK (`openai`, `@anthropic-ai/sdk`, `@aws-sdk/client-bedrock-runtime`). Zod for all schemas.

This deviates from the company's internal AWS/CDK/Amplify/Turborepo/Bedrock+OpenSearch stack described in the installed kit agents/skills (`metagross`, `alakazam`, `build-rag-systems`) — no AWS account, and Vercel is itself one of the company's sanctioned patterns per `use-elephant-query-db` ("use when building Vercel apps... that query Elephant oracle data"). Treat those AWS-oriented skills as reference only, not as the target architecture here.

## Style

- Server-only DB access — never expose `DATABASE_URL` or query logic to client code.
- Structured logging; no secrets, tokens, or PII in logs.
- Prefer the schema objects/reference snapshots the installed skills already provide (e.g. `use-elephant-query-db`'s Drizzle schema) over hand-rolling equivalents.

## Installed agents/skills (soofi-xyz kit)

| Name | Type | When to use |
|---|---|---|
| `donphan` | agent | Exploring live Oracle data via the `elephant` MCP server |
| `oracle` | agent | County ingestion — reference only, Oracle's ingestion is already done |
| `espeon` | agent | RAG design — local-tier first, matches our approach |
| `alakazam` | agent | AWS-production RAG — reference only |
| `metagross` | agent | Amplify/CDK monorepo conventions — reference only |
| `use-elephant-mcp` | skill | Tool catalog + consolidated property JSON shape reference |
| `use-elephant-query-db` | skill | Schema source — adopt/trim its real Drizzle tables even without live DB credentials (schema code is public) |
| `use-oracle` | skill | Reference only — ingestion already done |
| `build-frontend-backends` | skill | Reference only — Amplify/CDK pattern we're not using |
| `build-local-rag-pocs` | skill | Closest match to our RAG approach (adapt libSQL → pgvector) |
| `build-rag-systems` | skill | Reference only — AWS production tier |
| `apply-engineering-guidelines` | skill | Baseline conventions — TypeScript/Vercel AI SDK/Zod/Vitest parts apply, AWS/CDK/PagerDuty/Lexicon-registration parts don't (no access) |
| `integrate-ci-cd` | skill | Reference only — depends on a private company repo we don't have |

Global `slowking`/`arceus`/`evaluate-candidate-*` (in `~/.claude/`) are the hiring evaluation rubric — usable to self-check this submission.

## Entity model

Canonical entities (Property, Owner, Tenant, Business, Contractor, Permit, Address, Parcel, Project, Review, Complaint, Public Record) and their relationships are documented in `ENTITY-MODEL.md`. Two schemas matter here and aren't the same thing: the public **Elephant Lexicon** (thin — solid on Property/Parcel/Address/Owner/Sales/Tax, nothing else) and **`elephant-query-db`** (the company's real, public-on-GitHub Postgres schema, considerably richer). Checked directly against both: Permit, Contractor, Business, Review, and Complaint already have real tables in `elephant-query-db` (reuse, don't hand-roll) — **Tenant**, **Project**, and **Public Record** are genuinely new (Public Record is a dedicated `public_records` table, not scattered columns — see `ENTITY-MODEL.md`).
