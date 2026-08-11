// Cobalt: id + hashing helpers (verbatim from spec §9.5).

/** 8-char random id. */
export const genId = (): string => Math.random().toString(36).substring(2, 10);

/** Stable non-negative hash of a string (used for dedup ids). */
export const dateHash = (s: string): number => {
  let h = 0;
  for (const c of s) h = (h << 5) - h + c.charCodeAt(0);
  return Math.abs(h);
};
