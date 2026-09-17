import { z } from "zod";
import { isoDateParam } from "./params";

const text = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) =>
  text(max)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();

// Amounts arrive as decimal strings and are parsed against the user's currency.
export const amountInput = z.string().trim().min(1, "Amount is required");

export const orderCreateSchema = z.object({
  providerId: z.uuid(),
  merchant: text(200).min(1, "Merchant is required"),
  reference: optionalText(100),
  channel: z.enum(["online", "in_store"]).default("online"),
  purchasedOn: isoDateParam,
  totalAmount: amountInput,
  instalmentCount: z.coerce.number().int().min(1).max(60).default(4),
  firstDueOn: isoDateParam.optional().or(z.literal("").transform(() => undefined)),
  intervalDays: z.coerce.number().int().min(1).max(366).default(14),
  notes: optionalText(2000),
});
export type OrderCreateInput = z.infer<typeof orderCreateSchema>;

export const orderPatchSchema = z
  .object({
    providerId: z.uuid(),
    merchant: text(200).min(1),
    reference: optionalText(100),
    channel: z.enum(["online", "in_store"]),
    purchasedOn: isoDateParam,
    notes: optionalText(2000),
    cancelled: z.coerce.boolean(),
  })
  .partial();
export type OrderPatchInput = z.infer<typeof orderPatchSchema>;

export const paymentSchema = z.object({
  amount: amountInput,
  paidOn: isoDateParam,
  method: z.enum(["card", "bank", "cash", "other"]).default("card"),
  reference: optionalText(100),
  pending: z.coerce.boolean().default(false),
});
export type PaymentInput = z.infer<typeof paymentSchema>;

export const feeSchema = z.object({
  amount: amountInput,
  kind: z.enum(["late", "establishment", "other"]).default("late"),
  incurredOn: isoDateParam,
  note: optionalText(500),
});
export type FeeInput = z.infer<typeof feeSchema>;

export const refundSchema = z.object({
  amount: amountInput,
  refundedOn: isoDateParam,
  note: optionalText(500),
});
export type RefundInput = z.infer<typeof refundSchema>;

const email = z.email().trim().toLowerCase().max(200);
const password = z.string().min(8, "Use at least 8 characters").max(200);

export const loginSchema = z.object({ email, password: z.string().min(1) });

export const setupSchema = z.object({
  email,
  name: optionalText(120),
  password,
});

export const passwordChangeSchema = z.object({
  currentPassword: z.string().optional(),
  newPassword: password,
});

export const profileSchema = z
  .object({
    email,
    name: optionalText(120),
    currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Use a 3-letter currency code"),
    timeZone: z
      .string()
      .trim()
      .refine((tz) => Intl.supportedValuesOf("timeZone").includes(tz), "Unknown time zone"),
  })
  .partial();
export type ProfileInput = z.infer<typeof profileSchema>;

export const passkeyNameSchema = z.object({ name: optionalText(80) });

export const providerSchema = z.object({
  name: text(120).min(1, "Name is required"),
  kind: z.enum(["bnpl", "store_finance", "loan", "other"]).default("bnpl"),
  website: optionalText(300),
  supportPhone: optionalText(60),
  notes: optionalText(2000),
});
export type ProviderInput = z.infer<typeof providerSchema>;
