/**
 * Money as an integer number of minor units (øre, paise) plus a currency code.
 *
 * Amounts in different currencies never mix implicitly: adding or comparing
 * NOK with INR throws. The only way across currencies is `convert`, with a
 * rate the caller supplies. It is used for the management report only.
 */

export class CurrencyMismatch extends Error {
  name = "CurrencyMismatch";
}

export class Money {
  readonly minor: number;
  readonly currency: string;

  private constructor(minor: number, currency: string) {
    if (!Number.isSafeInteger(minor)) throw new RangeError(`not a whole number of minor units: ${minor}`);
    this.minor = minor;
    this.currency = currency;
  }

  /** `Money.of(1200, "NOK")` or `Money.of("1199.50", "NOK")`. */
  static of(major: number | string, currency: string): Money {
    return new Money(Math.round(Number(major) * 100), currency);
  }

  static fromMinor(minor: number, currency: string): Money {
    return new Money(minor, currency);
  }

  static zero(currency: string): Money {
    return new Money(0, currency);
  }

  private same(other: Money): void {
    if (other.currency !== this.currency) {
      throw new CurrencyMismatch(`cannot combine ${this.currency} with ${other.currency}`);
    }
  }

  plus(other: Money): Money {
    this.same(other);
    return new Money(this.minor + other.minor, this.currency);
  }

  minus(other: Money): Money {
    this.same(other);
    return new Money(this.minor - other.minor, this.currency);
  }

  compare(other: Money): number {
    this.same(other);
    return Math.sign(this.minor - other.minor);
  }

  lessThan(other: Money): boolean {
    return this.compare(other) < 0;
  }

  greaterThan(other: Money): boolean {
    return this.compare(other) > 0;
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.minor === other.minor;
  }

  isPositive(): boolean {
    return this.minor > 0;
  }

  toString(): string {
    const major = (this.minor / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `${major} ${this.currency}`;
  }
}

export function minMoney(a: Money, b: Money): Money {
  return a.compare(b) <= 0 ? a : b;
}

export function sum(amounts: Iterable<Money>, currency: string): Money {
  let result = Money.zero(currency);
  for (const m of amounts) result = result.plus(m);
  return result;
}

/** `rates[source]` = units of `to` per 1 unit of `source`. Rounds to the nearest minor unit. */
export function convert(m: Money, to: string, rates: Readonly<Record<string, number>>): Money {
  if (m.currency === to) return m;
  const rate = rates[m.currency];
  if (rate === undefined) throw new Error(`no ${m.currency}->${to} rate supplied`);
  return Money.fromMinor(Math.round(m.minor * rate), to);
}
