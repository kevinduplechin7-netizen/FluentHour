type JsonValue = any;

const LS_PREFIX = "sph:";

function safeJsonParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function lsGet<T>(key: string, fallback: T): T {
  return safeJsonParse<T>(localStorage.getItem(LS_PREFIX + key), fallback);
}

export function lsSet(key: string, value: JsonValue) {
  localStorage.setItem(LS_PREFIX + key, JSON.stringify(value));
}

/**
 * Baseline: reliable localStorage.
 * Next milestone: add IndexedDB behind these same calls.
 * Keep async interface now so we can swap in IDB later.
 */
export async function kvGet<T>(key: string, fallback: T): Promise<T> {
  return lsGet<T>(key, fallback);
}

export async function kvSet(key: string, value: JsonValue): Promise<void> {
  lsSet(key, value);
}
