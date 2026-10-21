export const dynamic = "force-dynamic";
export function GET() {
  return Response.json(
    { status: "ok", service: "stenzo-admin" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
