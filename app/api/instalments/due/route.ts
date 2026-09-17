import { NextResponse, type NextRequest } from "next/server";
import { handleApiError, jsonError, requireContext } from "@/lib/api/handler";
import { buildPage, listParamsSchema, parseSearchParams } from "@/lib/api/params";
import { serializeInstalment } from "@/lib/api/serialize";
import { summarize } from "@/lib/db/queries";

export async function GET(request: NextRequest) {
  try {
    const parsed = parseSearchParams(listParamsSchema.pick({ offset: true, limit: true }), request.nextUrl.searchParams);
    if (!parsed.ok) return jsonError(400, parsed.error);
    const { db, user, today } = await requireContext();
    const summary = await summarize(db, user.id, user.currency, today);
    const { offset, limit } = parsed.value;
    const slice = summary.nextDue.slice(offset, offset + limit).map((i) => ({
      ...serializeInstalment(i, user.currency),
      order: {
        id: i.order.id,
        merchant: i.order.merchant,
        reference: i.order.reference,
        instalmentCount: i.order.instalmentCount,
        provider: { id: i.order.provider.id, name: i.order.provider.name },
      },
    }));
    return NextResponse.json(buildPage(slice, summary.nextDue.length, { offset, limit }, request.url));
  } catch (error) {
    return handleApiError(error);
  }
}
