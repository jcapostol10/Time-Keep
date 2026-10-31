/** Top-level function bodies by name (exported or not), found by brace matching. */
export function functions(source: string): Map<string, { exported: boolean; body: string }> {
  const out = new Map<string, { exported: boolean; body: string }>();
  const header = /^(export\s+)?(?:async\s+)?function\s+(\w+)\s*(?:<[^>]*>)?\s*\(/gm;
  for (let m = header.exec(source); m; m = header.exec(source)) {
    let i = source.indexOf("{", source.indexOf(")", m.index));
    // Skip a return type annotation that contains braces, e.g. Promise<{ a: b }>.
    let depthParen = 0;
    for (let j = m.index + m[0].length - 1; j < source.length; j++) {
      const c = source[j];
      if (c === "(") depthParen++;
      else if (c === ")") {
        depthParen--;
        if (depthParen === 0) {
          i = j;
          break;
        }
      }
    }
    // The body starts at the first "{" after the parameter list at angle-bracket depth 0.
    let angle = 0;
    let start = -1;
    for (let j = i + 1; j < source.length; j++) {
      const c = source[j];
      if (c === "<") angle++;
      else if (c === ">" && source[j - 1] !== "=") angle--;
      else if (
        c === "{" &&
        angle <= 0 &&
        source
          .slice(i + 1, j)
          .trim()
          .match(/(^|[\s>)\]])$|^:\s*[\w.]+$|^$/)
      ) {
        start = j;
        break;
      } else if (c === "{" && angle <= 0) {
        // an object type in the return annotation: skip it
        let d = 0;
        for (; j < source.length; j++) {
          if (source[j] === "{") d++;
          else if (source[j] === "}" && --d === 0) break;
        }
      }
    }
    if (start < 0) continue;
    let depth = 0;
    let end = start;
    for (; end < source.length; end++) {
      if (source[end] === "{") depth++;
      else if (source[end] === "}" && --depth === 0) break;
    }
    out.set(m[2]!, { exported: Boolean(m[1]), body: source.slice(start, end + 1) });
  }
  return out;
}
