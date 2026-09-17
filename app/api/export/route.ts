import { asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { handleApiError, requireContext } from "@/lib/api/handler";
import { orders, providers } from "@/lib/db/schema";

// Everything the account owns, with money as integer minor units so the file
// round-trips without loss.
export async function GET() {
  try {
    const { db, user, today } = await requireContext();
    const [providerRows, orderRows] = await Promise.all([
      db.query.providers.findMany({ where: eq(providers.userId, user.id), orderBy: [asc(providers.name)] }),
      db.query.orders.findMany({
        where: eq(orders.userId, user.id),
        orderBy: [asc(orders.purchasedAt)],
        with: {
          instalments: { with: { fees: true, payments: true }, orderBy: (i, { asc }) => [asc(i.sequence)] },
          refunds: true,
        },
      }),
    ]);

    const body = JSON.stringify(
      {
        format: "owing-export",
        version: 1,
        exportedOn: today,
        account: { email: user.email, name: user.name, currency: user.currency, timeZone: user.timeZone },
        providers: providerRows.map((p) => ({ ...p, userId: undefined })),
        orders: orderRows.map((o) => ({ ...o, userId: undefined })),
      },
      null,
      2,
    );
    return new NextResponse(body, {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="owing-export-${today}.json"`,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
