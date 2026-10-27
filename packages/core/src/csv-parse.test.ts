import { describe, expect, it } from "vitest";

import { parseCsv } from "./csv-parse";

describe("parseCsv", () => {
  it("reads quoted fields with commas, doubled quotes and embedded newlines", () => {
    expect(parseCsv('email,note\na@b.co,"Hello, ""world""\nline two"\n')).toEqual([
      ["email", "note"],
      ["a@b.co", 'Hello, "world"\nline two'],
    ]);
  });

  it("strips a BOM, accepts CRLF and ignores a trailing newline", () => {
    expect(parseCsv("\uFEFFa,b\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("detects a semicolon delimiter from the header", () => {
    expect(parseCsv("email;role;groups\nx@y.co;admin;Design, Dev\n")).toEqual([
      ["email", "role", "groups"],
      ["x@y.co", "admin", "Design, Dev"],
    ]);
  });

  it("keeps empty fields and skips blank lines", () => {
    expect(parseCsv("a,b,c\n1,,3\n\n4,5,\n")).toEqual([
      ["a", "b", "c"],
      ["1", "", "3"],
      ["4", "5", ""],
    ]);
  });

  it("returns nothing for empty input", () => {
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv("\uFEFF\n")).toEqual([]);
  });
});
