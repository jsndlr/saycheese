export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_CONVEX_SITE_URL}/health`,
      {
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      },
    );

    return Response.json(
      { ok: response.ok, web: true, convex: response.status },
      { status: response.status },
    );
  } catch (error) {
    const timedOut =
      error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError");

    return Response.json(
      {
        ok: false,
        web: true,
        convex: null,
        error: timedOut ? "timeout" : "unreachable",
      },
      { status: 503 },
    );
  }
}
