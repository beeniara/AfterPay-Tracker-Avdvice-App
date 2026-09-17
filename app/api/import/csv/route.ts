import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { handleApiError, parseBody, readJson, requireContext, revalidateMoneyPaths } from "@/lib/api/handler";
import { isoDateParam } from "@/lib/api/params";
import { commitImport, prepareImport, type ImportPlan } from "@/lib/import/orders";
import { toMoney } from "@/lib/money";

const rowSchema = z.object({
  date: z.string().max(40),
  merchant: z.string().max(300),
  reference: z.string().max(100),
  totalAmount: z.string().max(40),
  amountOwing: z.string().max(40),
  channel: z.string().max(40).optional(),
  status: z.string().max(40).optional(),
});

const bodySchema = z.object({
  mode: z.enum(["preview", "commit"]),
  rows: z.array(rowSchema).min(1).max(5000),
  options: z.object({
    providerName: z.string().trim().min(1).max(120),
    providerKind: z.enum(["bnpl", "store_finance", "loan", "other"]).default("bnpl"),
    instalmentCount: z.coerce.number().int().min(1).max(60).default(4),
    intervalDays: z.coerce.number().int().min(1).max(366).default(14),
    cycleAnchor: isoDateParam.optional().or(z.literal("").transform(() => undefined)),
    replace: z.coerce.boolean().default(false),
  }),
});

function summarise(plan: ImportPlan, currency: string) {
  return {
    valid: plan.rows.length,
    invalid: plan.errors.length,
    errors: plan.errors.slice(0, 20),
    statusMismatches: plan.statusMismatches,
    total: toMoney(plan.totalCents, currency),
    owing: toMoney(plan.owingCents, currency),
    sample: plan.rows.slice(0, 5).map((r) => ({
      merchant: r.merchant,
      reference: r.reference,
      purchasedOn: r.purchasedOn,
      channel: r.channel,
      total: toMoney(r.total, currency),
      owing: toMoney(r.owing, currency),
      firstDueOn: r.schedule[0]?.dueOn,
      paidInstalments: r.paid.filter((p) => p > 0).length,
    })),
  };
}

export async function POST(request: NextRequest) {
  try {
    const { db, user } = await requireContext();
    const body = parseBody(bodySchema, await readJson(request));
    const options = { ...body.options, currency: user.currency };
    const plan = prepareImport(body.rows, options);

    if (body.mode === "preview") return NextResponse.json(summarise(plan, user.currency));
    if (plan.errors.length) {
      return NextResponse.json({ error: "Fix the invalid rows before importing", ...summarise(plan, user.currency) }, { status: 400 });
    }
    const result = await commitImport(db, user.id, plan, options);
    revalidateMoneyPaths();
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
