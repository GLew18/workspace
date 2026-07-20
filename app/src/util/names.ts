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
 * "zaki@gmail.com" → "Zaki"; "gabriel.lewinsohn@gmail.com" → "Gabriel".
 */
export function nameFromEmail(email: string): string {
  const local = (email.split('@')[0] || '').split(/[.\-_+]/)[0];
  const letters = local.replace(/[^a-zA-Z]/g, '');
  return letters ? capitalizeName(letters) : '';
}
