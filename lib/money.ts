export interface Money {
  amount: string;
  currency: string;
  symbol: string;
}

export interface Cents {
  cents: number;
  currency: string;
}

export class CurrencyMismatchError extends Error {
  constructor(expected: string, actual: string) {
    super(`Cannot combine ${expected} with ${actual}`);
    this.name = "CurrencyMismatchError";
  }
}

export class InvalidMoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidMoneyError";
  }
}

const CURRENCY_CODE = /^[A-Z]{3}$/;
const AMOUNT = /^(-)?(\d+)(?:\.(\d*))?$/;
const formatters = new Map<string, Intl.NumberFormat>();

function formatter(currency: string): Intl.NumberFormat {
  if (!CURRENCY_CODE.test(currency)) {
    throw new InvalidMoneyError(`Invalid currency code "${currency}"`);
  }
  let f = formatters.get(currency);
  if (!f) {
    f = new Intl.NumberFormat("en", {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
    });
    formatters.set(currency, f);
  }
  return f;
}

export function minorUnits(currency: string): number {
  return formatter(currency).resolvedOptions().maximumFractionDigits ?? 2;
}

export function symbolFor(currency: string): string {
  const part = formatter(currency)
    .formatToParts(0)
    .find((p) => p.type === "currency");
  return part ? part.value : currency;
}

export function toMoney(cents: number, currency: string): Money {
  if (!Number.isSafeInteger(cents)) {
    throw new InvalidMoneyError(
      `Amount must be an integer number of minor units, got ${cents}`,
    );
  }
  const units = minorUnits(currency);
  const scale = 10 ** units;
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / scale);
  const fraction = abs % scale;
  const digits =
    units === 0
      ? String(whole)
      : `${whole}.${String(fraction).padStart(units, "0")}`;
  return {
    amount: cents < 0 ? `-${digits}` : digits,
    currency,
    symbol: symbolFor(currency),
  };
}

export function fromMoney(money: Pick<Money, "amount" | "currency">): Cents {
  const units = minorUnits(money.currency);
  const match = AMOUNT.exec(money.amount.trim());
  if (!match) {
    throw new InvalidMoneyError(`Cannot parse amount "${money.amount}"`);
  }
  const [, sign, whole = "0", fraction = ""] = match;
  if (fraction.length > units) {
    throw new InvalidMoneyError(
      `"${money.amount}" has more than ${units} decimal places for ${money.currency}`,
    );
  }
  const cents =
    Number(whole) * 10 ** units + Number(fraction.padEnd(units, "0") || "0");
  if (!Number.isSafeInteger(cents)) {
    throw new InvalidMoneyError(`Amount "${money.amount}" is too large`);
  }
  return { cents: sign ? -cents : cents, currency: money.currency };
}

// For user-typed or CSV input: tolerates symbols, thousands separators, spaces.
export function parseAmount(text: string, currency: string): Cents {
  return fromMoney({ amount: text.replace(/[^\d.-]/g, ""), currency });
}

export function sumCents(values: readonly Cents[], currency: string): Cents {
  let total = 0;
  for (const value of values) {
    if (value.currency !== currency) {
      throw new CurrencyMismatchError(currency, value.currency);
    }
    total += value.cents;
  }
  return { cents: total, currency };
}

export function addMoney(a: Money, b: Money): Money {
  const total = sumCents([fromMoney(a), fromMoney(b)], a.currency);
  return toMoney(total.cents, a.currency);
}

export function formatMoney(money: Money, locale = "en-NZ"): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: money.currency,
    currencyDisplay: "narrowSymbol",
  }).format(Number(money.amount));
}
