import { NextResponse } from "next/server";
import { handleApiError, requireContext } from "@/lib/api/handler";
import { serializeInsights } from "@/lib/api/serialize";
import { loadAllOrders } from "@/lib/db/queries";
import { formatCents, formatDate } from "@/lib/format";
import { buildInsights } from "@/lib/insights";

export async function GET() {
  try {
    const { db, user, today } = await requireContext();
    const orders = await loadAllOrders(db, user.id, today);
    const insights = buildInsights(orders, today, {
      money: (cents) => formatCents(cents, user.currency),
      date: (iso) => formatDate(iso, "dayMonth"),
    });
    return NextResponse.json(serializeInsights(insights, user.currency));
  } catch (error) {
    return handleApiError(error);
  }
}
