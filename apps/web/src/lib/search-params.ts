/** A page's search params as URLSearchParams (repeated keys for arrays). */
export function searchParamsOf(
  raw: Record<string, string | string[] | undefined>,
): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    if (Array.isArray(value)) for (const v of value) params.append(key, v);
    else if (typeof value === "string") params.set(key, value);
  }
  return params;
}
