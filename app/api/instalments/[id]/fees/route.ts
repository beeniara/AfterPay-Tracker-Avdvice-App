import { NextResponse, type NextRequest } from "next/server";
import {
  handleApiError,
  parseBody,
  readJson,
  requireContext,
  revalidateMoneyPaths,
} from "@/lib/api/handler";
import { feeSchema } from "@/lib/api/schemas";
import { recordFee } from "@/lib/db/mutations";
import { parseAmount } from "@/lib/money";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { db, user } = await requireContext();
    const input = parseBody(feeSchema, await readJson(request));
    await recordFee(db, user.id, id, {
      ...input,
      amountCents: parseAmount(input.amount, user.currency).cents,
    });
    revalidateMoneyPaths();
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
