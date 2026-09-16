import { NextRequest, NextResponse } from "next/server";

// GET /api/f1?u=<encoded OpenF1 URL>
// Forwards to OpenF1 server-side (no browser CORS) and caches historical data hard
// at the edge. Only api.openf1.org may be proxied.
export async function GET(req: NextRequest) {
  const u = req.nextUrl.searchParams.get("u");
  if (!u) return NextResponse.json({ error: "Missing ?u= parameter" }, { status: 400 });

  let target: URL;
  try {
    target = new URL(u);
  } catch {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }
  if (target.protocol !== "https:" || target.hostname !== "api.openf1.org") {
    return NextResponse.json({ error: "Only https://api.openf1.org is allowed" }, { status: 403 });
  }

  try {
    // Fetch the original decoded string to preserve OpenF1's operator syntax (date>=…).
    const upstream = await fetch(u, {
      headers: { Accept: "application/json" },
      next: { revalidate: 86400 },
    });
    const body = await upstream.text();
    return new NextResponse(body, {
      status: upstream.status,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": upstream.ok
          ? "public, s-maxage=86400, stale-while-revalidate=604800"
          : "no-store",
      },
    });
  } catch (err) {
    return NextResponse.json({ error: "Upstream fetch failed", detail: String(err) }, { status: 502 });
  }
}
