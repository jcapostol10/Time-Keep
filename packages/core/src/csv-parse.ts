/**
 * An RFC 4180 CSV reader for imports: quoted fields (with doubled quotes,
 * commas and newlines inside), CRLF or LF, a leading BOM, and a `;`
 * delimiter when the header line has more semicolons than commas (as
 * spreadsheets in many locales write). Blank lines are skipped.
 */
export function parseCsv(text: string): string[][] {
  const input = text.startsWith("﻿") ? text.slice(1) : text;
  const firstLine = input.slice(0, input.search(/\r?\n|$/));
  const delimiter = count(firstLine, ";") > count(firstLine, ",") ? ";" : ",";

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;
  const endRow = () => {
    row.push(field);
    field = "";
    if (row.length > 1 || row[0] !== "") rows.push(row);
    row = [];
  };
  while (i < input.length) {
    const c = input[i]!;
    if (quoted) {
      if (c === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
      } else {
        field += c;
      }
      i++;
      continue;
    }
    if (c === '"' && field === "") {
      quoted = true;
    } else if (c === delimiter) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && input[i + 1] === "\n") i++;
      endRow();
    } else {
      field += c;
    }
    i++;
  }
  if (field !== "" || row.length > 0) endRow();
  return rows;
}

function count(text: string, ch: string): number {
  let n = 0;
  for (const c of text) if (c === ch) n++;
  return n;
}
