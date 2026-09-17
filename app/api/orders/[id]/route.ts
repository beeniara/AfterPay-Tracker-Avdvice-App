import { NextResponse, type NextRequest } from "next/server";
import {
  handleApiError,
  jsonError,
  parseBody,
  readJson,
  requireContext,
  revalidateMoneyPaths,
} from "@/lib/api/handler";
import { orderPatchSchema } from "@/lib/api/schemas";
import { serializeOrder } from "@/lib/api/serialize";
import { deleteOrder, updateOrder } from "@/lib/db/mutations";
import { getOrder } from "@/lib/db/queries";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const { db, user, today } = await requireContext();
    const order = await getOrder(db, user.id, id, today);
    if (!order) return jsonError(404, "Order not found");
    return NextResponse.json(serializeOrder(order));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const { db, user, today } = await requireContext();
    const patch = parseBody(orderPatchSchema, await readJson(request));
    await updateOrder(db, user.id, id, patch);
    revalidateMoneyPaths(id);
    const order = await getOrder(db, user.id, id, today);
    return NextResponse.json(serializeOrder(order!));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const { db, user } = await requireContext();
    await deleteOrder(db, user.id, id);
    revalidateMoneyPaths(id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return handleApiError(error);
  }
}
