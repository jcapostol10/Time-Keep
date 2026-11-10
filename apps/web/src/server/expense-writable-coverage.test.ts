import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { functions } from "../../test/source-functions";

/**
 * Every exported writer of the expense service passes the Phase 6c guard
 * (decision 17): a function that writes `expense` (directly, or through a
 * function of the same file that does) must call `assertExpenseWritable`
 * (directly, or through a function that does), or be listed below with the
 * reason it may not.
 */

const FILE = path.resolve(__dirname, "expenses.ts");

const EXEMPT: Record<string, string> = {
  markExpensesInvoiced:
    "the invoice service marks and releases; invoiced expenses are read-only through the guard",
  releaseExpensesInvoiced:
    "the invoice service marks and releases; invoiced expenses are read-only through the guard",
};

const WRITES = /\.(insert|update)\(expense\)/;

function calls(body: string, name: string): boolean {
  return new RegExp(`\\b${name}\\(`).test(body);
}

function closure(
  fns: Map<string, { body: string }>,
  direct: (body: string) => boolean,
): Set<string> {
  const found = new Set([...fns].filter(([, f]) => direct(f.body)).map(([n]) => n));
  for (let grew = true; grew;) {
    grew = false;
    for (const [name, f] of fns) {
      if (!found.has(name) && [...found].some((n) => n !== name && calls(f.body, n))) {
        found.add(name);
        grew = true;
      }
    }
  }
  return found;
}

describe("assertExpenseWritable coverage", () => {
  const fns = functions(readFileSync(FILE, "utf8"));
  const writers = closure(fns, (b) => WRITES.test(b));
  const guarded = closure(fns, (b) => calls(b, "assertExpenseWritable"));

  it("finds the writers", () => {
    for (const name of ["createExpense", "updateExpense", "deleteExpense", "restoreExpense"]) {
      expect(writers.has(name)).toBe(true);
    }
  });

  it("guards every exported writer", () => {
    const missing = [...fns]
      .filter(([name, f]) => f.exported && writers.has(name))
      .filter(([name]) => !guarded.has(name) && !(name in EXEMPT))
      .map(([name]) => name);
    expect(missing).toEqual([]);
  });

  it("lists only real exemptions", () => {
    for (const name of Object.keys(EXEMPT)) expect(writers.has(name)).toBe(true);
  });
});
