import { relations } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const providerKindEnum = pgEnum("provider_kind", [
  "bnpl",
  "store_finance",
  "loan",
  "other",
]);
export const orderChannelEnum = pgEnum("order_channel", ["online", "in_store"]);
export const orderStatusEnum = pgEnum("order_status", [
  "active",
  "settled",
  "cancelled",
]);
export const feeKindEnum = pgEnum("fee_kind", ["late", "establishment", "other"]);
export const paymentMethodEnum = pgEnum("payment_method", [
  "card",
  "bank",
  "cash",
  "other",
]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
};

// Column keys match what Auth.js's Drizzle adapter expects.
export const users = pgTable("users", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").notNull().unique(),
  emailVerified: timestamp("email_verified", { withTimezone: true }),
  image: text("image"),
  passwordHash: text("password_hash"),
  currency: text("currency").notNull().default("NZD"),
  timeZone: text("time_zone").notNull().default("Pacific/Auckland"),
  createdAt: timestamps.createdAt,
});

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    userAgent: text("user_agent"),
    createdAt: timestamps.createdAt,
  },
  (t) => [index("sessions_user_idx").on(t.userId), index("sessions_expires_idx").on(t.expiresAt)],
);

export const passkeys = pgTable(
  "passkeys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    credentialId: text("credential_id").notNull().unique(),
    publicKey: text("public_key").notNull(),
    counter: integer("counter").notNull().default(0),
    transports: text("transports"),
    deviceType: text("device_type"),
    backedUp: boolean("backed_up").notNull().default(false),
    name: text("name"),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamps.createdAt,
  },
  (t) => [index("passkeys_user_idx").on(t.userId)],
);

export const providers = pgTable(
  "providers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: providerKindEnum("kind").notNull().default("bnpl"),
    website: text("website"),
    supportPhone: text("support_phone"),
    notes: text("notes"),
    colorSeed: integer("color_seed").notNull().default(0),
    ...timestamps,
  },
  (t) => [
    index("providers_user_idx").on(t.userId),
    uniqueIndex("providers_user_name_unique").on(t.userId, t.name),
  ],
);

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    providerId: uuid("provider_id")
      .notNull()
      .references(() => providers.id, { onDelete: "restrict" }),
    merchant: text("merchant").notNull(),
    reference: text("reference"),
    channel: orderChannelEnum("channel").notNull().default("online"),
    purchasedAt: timestamp("purchased_at", { withTimezone: true }).notNull(),
    totalAmountCents: integer("total_amount_cents").notNull(),
    currency: text("currency").notNull(),
    instalmentCount: integer("instalment_count").notNull(),
    // Cache of the derived status; only ever written by refreshOrderStatus.
    status: orderStatusEnum("status").notNull().default("active"),
    notes: text("notes"),
    ...timestamps,
  },
  (t) => [
    index("orders_user_purchased_idx").on(t.userId, t.purchasedAt),
    index("orders_user_status_idx").on(t.userId, t.status),
    index("orders_provider_idx").on(t.providerId),
    index("orders_merchant_idx").on(t.merchant),
    uniqueIndex("orders_provider_reference_unique").on(t.providerId, t.reference),
  ],
);

export const instalments = pgTable(
  "instalments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    dueOn: date("due_on", { mode: "string" }).notNull(),
    principalCents: integer("principal_cents").notNull(),
    paidCents: integer("paid_cents").notNull().default(0),
    pendingCents: integer("pending_cents").notNull().default(0),
    waivedCents: integer("waived_cents").notNull().default(0),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("instalments_order_sequence_unique").on(t.orderId, t.sequence),
    index("instalments_due_idx").on(t.dueOn),
  ],
);

export const fees = pgTable(
  "fees",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    instalmentId: uuid("instalment_id")
      .notNull()
      .references(() => instalments.id, { onDelete: "cascade" }),
    kind: feeKindEnum("kind").notNull().default("late"),
    amountCents: integer("amount_cents").notNull(),
    incurredOn: date("incurred_on", { mode: "string" }).notNull(),
    note: text("note"),
    createdAt: timestamps.createdAt,
  },
  (t) => [index("fees_instalment_idx").on(t.instalmentId)],
);

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    instalmentId: uuid("instalment_id")
      .notNull()
      .references(() => instalments.id, { onDelete: "cascade" }),
    amountCents: integer("amount_cents").notNull(),
    paidOn: date("paid_on", { mode: "string" }).notNull(),
    method: paymentMethodEnum("method").notNull().default("card"),
    reference: text("reference"),
    createdAt: timestamps.createdAt,
  },
  (t) => [index("payments_instalment_idx").on(t.instalmentId)],
);

export const refunds = pgTable(
  "refunds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    amountCents: integer("amount_cents").notNull(),
    refundedOn: date("refunded_on", { mode: "string" }).notNull(),
    note: text("note"),
    createdAt: timestamps.createdAt,
  },
  (t) => [index("refunds_order_idx").on(t.orderId)],
);

export const askHistory = pgTable(
  "ask_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    question: text("question").notNull(),
    answer: text("answer"),
    sql: text("sql"),
    note: text("note"),
    model: text("model"),
    rowCount: integer("row_count"),
    error: text("error"),
    durationMs: integer("duration_ms").notNull().default(0),
    createdAt: timestamps.createdAt,
  },
  (t) => [index("ask_history_user_created_idx").on(t.userId, t.createdAt)],
);

export const usersRelations = relations(users, ({ many }) => ({
  providers: many(providers),
  orders: many(orders),
  sessions: many(sessions),
  passkeys: many(passkeys),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

export const passkeysRelations = relations(passkeys, ({ one }) => ({
  user: one(users, { fields: [passkeys.userId], references: [users.id] }),
}));

export const providersRelations = relations(providers, ({ one, many }) => ({
  user: one(users, { fields: [providers.userId], references: [users.id] }),
  orders: many(orders),
}));

export const ordersRelations = relations(orders, ({ one, many }) => ({
  user: one(users, { fields: [orders.userId], references: [users.id] }),
  provider: one(providers, {
    fields: [orders.providerId],
    references: [providers.id],
  }),
  instalments: many(instalments),
  refunds: many(refunds),
}));

export const instalmentsRelations = relations(instalments, ({ one, many }) => ({
  order: one(orders, { fields: [instalments.orderId], references: [orders.id] }),
  fees: many(fees),
  payments: many(payments),
}));

export const feesRelations = relations(fees, ({ one }) => ({
  instalment: one(instalments, {
    fields: [fees.instalmentId],
    references: [instalments.id],
  }),
}));

export const paymentsRelations = relations(payments, ({ one }) => ({
  instalment: one(instalments, {
    fields: [payments.instalmentId],
    references: [instalments.id],
  }),
}));

export const refundsRelations = relations(refunds, ({ one }) => ({
  order: one(orders, { fields: [refunds.orderId], references: [orders.id] }),
}));

export type User = typeof users.$inferSelect;
export type Provider = typeof providers.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type Instalment = typeof instalments.$inferSelect;
export type Fee = typeof fees.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type Refund = typeof refunds.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type AskHistoryRow = typeof askHistory.$inferSelect;
export type Passkey = typeof passkeys.$inferSelect;
export type ProviderKind = Provider["kind"];
export type OrderChannel = Order["channel"];
