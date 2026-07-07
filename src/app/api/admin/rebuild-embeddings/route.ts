import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { rebuildEmbeddings } from "@/server/rebuild-embeddings";

export const runtime = "nodejs";
export const maxDuration = 300;

// One-off/maintenance trigger: re-embeds properties and contractors against
// the CURRENT database state. Needed because the RAG index doesn't
// auto-refresh when ingestion adds data out of band (e.g. a bulk
// enrichment run) -- entity_embeddings can silently go stale relative to
// property_improvements/tenants/companies. Runs server-side (on Vercel,
// which already holds the AI Gateway credentials this needs) rather than
// requiring those credentials locally.
export async function POST(request: NextRequest): Promise<Response> {
  const expectedSecret = process.env.ADMIN_REBUILD_SECRET;
  if (expectedSecret === undefined || expectedSecret.trim().length === 0) {
    return NextResponse.json(
      { error: "ADMIN_REBUILD_SECRET is not configured" },
      { status: 500 },
    );
  }

  const providedSecret = request.headers.get("x-admin-secret");
  if (providedSecret !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await rebuildEmbeddings();
  return NextResponse.json({ status: "ok", ...result });
}
