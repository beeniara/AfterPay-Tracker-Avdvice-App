import { NextResponse, type NextRequest } from "next/server";
import {
  handleApiError,
  parseBody,
  readJson,
  requireContext,
  revalidateMoneyPaths,
} from "@/lib/api/handler";
import { refundSchema } from "@/lib/api/schemas";
import { recordRefund } from "@/lib/db/mutations";
import { parseAmount, toMoney } from "@/lib/money";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { db, user } = await requireContext();
    const input = parseBody(refundSchema, await readJson(request));
    const refund = await recordRefund(db, user.id, id, {
      ...input,
      amountCents: parseAmount(input.amount, user.currency).cents,
    });
    revalidateMoneyPaths(id);
    return NextResponse.json(
      { id: refund.id, amount: toMoney(refund.amountCents, user.currency), refundedOn: refund.refundedOn },
      { status: 201 },
    );
  } catch (error) {
    return handleApiError(error);
  }
}
