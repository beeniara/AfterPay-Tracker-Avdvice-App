import { NextResponse, type NextRequest } from "next/server";
import {
  handleApiError,
  jsonError,
  parseBody,
  readJson,
  requireContext,
  revalidateMoneyPaths,
} from "@/lib/api/handler";
import { buildPage, orderListQuerySchema, parseSearchParams } from "@/lib/api/params";
import { orderCreateSchema } from "@/lib/api/schemas";
import { serializeOrder } from "@/lib/api/serialize";
import { createOrder } from "@/lib/db/mutations";
import { getOrder, listOrders } from "@/lib/db/queries";
import { parseAmount } from "@/lib/money";

export async function GET(request: NextRequest) {
  try {
    const parsed = parseSearchParams(orderListQuerySchema, request.nextUrl.searchParams);
    if (!parsed.ok) return jsonError(400, parsed.error);
    const { db, user, today } = await requireContext();
    const page = await listOrders(db, user.id, parsed.value, today);
    return NextResponse.json(
      buildPage(page.results.map(serializeOrder), page.totalResults, parsed.value, request.url),
    );
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { db, user, today } = await requireContext();
    const input = parseBody(orderCreateSchema, await readJson(request));
    const id = await createOrder(db, user.id, {
      ...input,
      totalAmountCents: parseAmount(input.totalAmount, user.currency).cents,
      currency: user.currency,
    });
    revalidateMoneyPaths(id);
    const order = await getOrder(db, user.id, id, today);
    return NextResponse.json(serializeOrder(order!), { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
