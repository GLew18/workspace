// WorkSpace — display-name helpers.

/** Capitalize the first letter of each word; leaves the rest as typed. "zach" → "Zach". */
export function capitalizeName(input: string): string {
  return input
    .trim()
    .split(/\s+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

/**
 * Derive a friendly first name from an email's local part.
 *
 * THE RULE (Gabe, 8/7/26): the whole FIRST SECTION of the address is the name,
 * where sections are divided by any punctuation (., -, _, +, and so on),
 * because those characters almost always separate first name from last name or
 * name from school. No separators means the whole local part is one section
 * and is used as-is, digits included:
 *   "gabriel.lewinsohn.2030@heschel.org" → "Gabriel"
 *   "xxgamer_123@gmail.com"              → "Xxgamer"
 *   "xxgamer123@gmail.com"               → "Xxgamer123"  (no break, keep it all)
 *   "zaki@gmail.com"                     → "Zaki"
 * The result only pre-fills the editable name screen, so a weird handle costs
 * one retype, never a wrong greeting.
 */
export function nameFromEmail(email: string): string {
  const section = (email.split('@')[0] || '').split(/[^a-zA-Z0-9]/)[0];
  return section ? capitalizeName(section) : '';
}
