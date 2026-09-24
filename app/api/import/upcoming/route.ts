import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { handleApiError, parseBody, readJson, requireContext, revalidateMoneyPaths } from "@/lib/api/handler";
import { commitUpcoming, prepareUpcoming, type OrderUpdate, type UpcomingPlan } from "@/lib/import/upcoming";
import { toMoney } from "@/lib/money";

const rowSchema = z.object({
  merchant: z.string().max(300),
  paymentNo: z.string().max(40),
  dueDate: z.string().max(40),
  amount: z.string().max(40),
});

const bodySchema = z.object({
  mode: z.enum(["preview", "commit"]),
  rows: z.array(rowSchema).min(1).max(5000),
  options: z.object({
    providerName: z.string().trim().min(1).max(120),
    intervalDays: z.coerce.number().int().min(1).max(366).default(14),
    reopenSettled: z.coerce.boolean().default(true),
    settleMissing: z.coerce.boolean().default(true),
    createUnmatched: z.coerce.boolean().default(true),
  }),
});

const DETAIL_LIMIT = 80;

function describeUpdate(update: OrderUpdate, action: "update" | "reopen" | "settle") {
  const parts: string[] = [];
  if (update.redate.length) parts.push(`${update.redate.length} re-dated`);
  if (update.markPaid.length) parts.push(`${update.markPaid.length} marked paid`);
  if (update.reopen.length) parts.push(`${update.reopen.length} re-opened`);
  return { action, merchant: update.merchant, reference: update.reference, purchasedOn: update.purchasedOn, detail: parts.join(", ") };
}

function summarise(plan: UpcomingPlan, currency: string) {
  const details = [
    ...plan.updates.map((u) => describeUpdate(u, u.wasSettled ? "reopen" : "update")),
    ...plan.settles.map((s) => describeUpdate(s, "settle")),
    ...plan.creates.map((c) => ({
      action: "create" as const,
      merchant: c.merchant,
      reference: null,
      purchasedOn: c.purchasedOn,
      detail: `${c.schedule.filter((s) => s.paidCents === 0).length} of ${c.instalmentCount} still to pay · lines ${c.lines.join(", ")}`,
    })),
  ];
  return {
    valid: plan.rows.length,
    invalid: plan.errors.length,
    errors: plan.errors.slice(0, 20),
    orders: plan.chains.length,
    updated: plan.updates.filter((u) => !u.wasSettled).length,
    reopened: plan.updates.filter((u) => u.wasSettled).length,
    created: plan.creates.length,
    settled: plan.settles.length,
    unchanged: plan.updates.filter((u) => !u.redate.length && !u.markPaid.length && !u.reopen.length).length,
    redated: plan.updates.reduce((n, u) => n + u.redate.length, 0),
    markedPaid: [...plan.updates, ...plan.settles].reduce((n, u) => n + u.markPaid.length, 0),
    reopenedInstalments: plan.updates.reduce((n, u) => n + u.reopen.length, 0),
    upcoming: toMoney(plan.upcomingCents, currency),
    owingBefore: toMoney(plan.owingBefore, currency),
    owingAfter: toMoney(plan.owingAfter, currency),
    details: details.slice(0, DETAIL_LIMIT),
    moreDetails: Math.max(0, details.length - DETAIL_LIMIT),
  };
}

export async function POST(request: NextRequest) {
  try {
    const { db, user, today } = await requireContext();
    const body = parseBody(bodySchema, await readJson(request));
    const options = { ...body.options, currency: user.currency };

    if (body.mode === "preview") {
      const plan = await prepareUpcoming(db, user.id, body.rows, options, today);
      return NextResponse.json(summarise(plan, user.currency));
    }
    const result = await commitUpcoming(db, user.id, body.rows, options, today);
    revalidateMoneyPaths();
    const { plan, ...counts } = result;
    return NextResponse.json({ ...counts, ...summarise(plan, user.currency) }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
