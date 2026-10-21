export const dynamic = "force-dynamic";
export function GET() {
  return Response.json(
    { status: "ok", service: "stenzo-miniapp" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
