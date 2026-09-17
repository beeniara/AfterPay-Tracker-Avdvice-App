import { z } from "zod";
import { isIsoDate } from "@/lib/dates";

export const MAX_LIMIT = 200;

export interface Page<T> {
  totalResults: number;
  offset: number;
  limit: number;
  nextPageUrl: string | null;
  results: T[];
}

export const isoDateParam = z
  .string()
  .refine(isIsoDate, { message: "Expected a YYYY-MM-DD date" });

export const ORDER_SORT_FIELDS = [
  "purchasedAt",
  "merchant",
  "totalAmountCents",
  "status",
] as const;
export type OrderSortField = (typeof ORDER_SORT_FIELDS)[number];

export const listParamsSchema = z.object({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .default(25)
    .transform((n) => Math.min(n, MAX_LIMIT)),
  orderBy: z.enum(ORDER_SORT_FIELDS).default("purchasedAt"),
  ascending: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
});
export type ListParams = z.infer<typeof listParamsSchema>;

const optionalText = z
  .string()
  .trim()
  .max(200)
  .transform((v) => (v === "" ? undefined : v))
  .optional();

export const orderFiltersSchema = z.object({
  q: optionalText,
  merchant: optionalText,
  providerId: z.uuid().optional(),
  status: z.enum(["active", "settled", "cancelled"]).optional(),
  from: isoDateParam.optional(),
  to: isoDateParam.optional(),
});
export type OrderFilters = z.infer<typeof orderFiltersSchema>;

export const orderListQuerySchema = listParamsSchema.extend(orderFiltersSchema.shape);
export type OrderListQuery = z.infer<typeof orderListQuerySchema>;

export type SearchParamsInput =
  | URLSearchParams
  | Record<string, string | string[] | undefined>;

function toRecord(input: SearchParamsInput): Record<string, string> {
  const out: Record<string, string> = {};
  if (input instanceof URLSearchParams) {
    for (const [key, value] of input) out[key] = value;
    return out;
  }
  for (const [key, value] of Object.entries(input)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (first !== undefined) out[key] = first;
  }
  return out;
}

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export function parseSearchParams<T extends z.ZodType>(
  schema: T,
  input: SearchParamsInput,
): ParseResult<z.output<T>> {
  const record = toRecord(input);
  // Empty strings from blank form fields mean "not set".
  for (const key of Object.keys(record)) {
    if (record[key] === "") delete record[key];
  }
  const result = schema.safeParse(record);
  return result.success
    ? { ok: true, value: result.data }
    : { ok: false, error: z.prettifyError(result.error) };
}

export function buildPage<T>(
  results: T[],
  totalResults: number,
  params: Pick<ListParams, "offset" | "limit">,
  requestUrl: string | URL,
): Page<T> {
  const nextOffset = params.offset + params.limit;
  let nextPageUrl: string | null = null;
  if (nextOffset < totalResults) {
    const url = new URL(requestUrl);
    url.searchParams.set("offset", String(nextOffset));
    url.searchParams.set("limit", String(params.limit));
    nextPageUrl = url.pathname + url.search;
  }
  return { totalResults, offset: params.offset, limit: params.limit, nextPageUrl, results };
}
