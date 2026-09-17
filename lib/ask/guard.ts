export const ALLOWED_TABLES = ["providers", "orders", "instalments", "fees", "payments", "refunds"] as const;

const FORBIDDEN_WORDS = [
  "insert", "update", "delete", "merge", "drop", "alter", "create", "truncate", "grant", "revoke",
  "copy", "vacuum", "analyze", "analyse", "lock", "listen", "notify", "set", "reset", "show",
  "explain", "do", "call", "execute", "prepare", "deallocate", "into", "returning", "recursive",
  "pg_sleep", "pg_read_file", "pg_read_binary_file", "pg_ls_dir", "pg_stat_file", "dblink",
  "lo_import", "lo_export", "current_setting", "set_config", "pg_terminate_backend",
  "pg_cancel_backend", "users", "sessions", "passkeys", "information_schema", "pg_catalog",
];
const FORBIDDEN = new RegExp(`\\b(${FORBIDDEN_WORDS.join("|")})\\b`, "i");
const SCHEMA_PREFIX = /\b(public|pg_[a-z_]*)\s*\./i;
const SYSTEM_OBJECT = /\bpg_[a-z_]+\b/i;

export class UnsafeSqlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeSqlError";
  }
}

// Accepts a single plain SELECT (optionally with its own WITH) and returns it
// cleaned up; throws on anything else.
export function guardSql(raw: string): string {
  let query = raw.trim();
  if (query.startsWith("```")) {
    query = query.replace(/^```[a-z]*\s*/i, "").replace(/```\s*$/, "").trim();
  }
  query = query.replace(/;\s*$/, "").trim();

  if (query.length === 0) throw new UnsafeSqlError("The model returned an empty query");
  if (query.length > 4000) throw new UnsafeSqlError("The query is too long");
  if (query.includes(";")) throw new UnsafeSqlError("Only a single statement is allowed");
  if (query.includes("--") || query.includes("/*")) throw new UnsafeSqlError("Comments are not allowed");
  if (/\$\d|\$\$/.test(query)) throw new UnsafeSqlError("Parameter placeholders are not allowed");
  if (!/^(select|with)\b/i.test(query)) throw new UnsafeSqlError("Only SELECT queries are allowed");
  if (/^with\b/i.test(query) && !/\bselect\b/i.test(query)) {
    throw new UnsafeSqlError("Only SELECT queries are allowed");
  }

  const forbidden = FORBIDDEN.exec(query);
  if (forbidden) throw new UnsafeSqlError(`"${forbidden[1]!.toLowerCase()}" is not allowed in a question query`);
  if (SCHEMA_PREFIX.test(query)) throw new UnsafeSqlError("Schema-qualified names are not allowed");
  if (SYSTEM_OBJECT.test(query)) throw new UnsafeSqlError("System objects are not allowed");

  return query;
}
