// WorkSpace — shared URL helper.
//
// normalizeUrl was lifted out of bookmarks/view.ts so both the view and the
// shortcuts module (which builds ShortcutEntry.url for the extension config)
// produce byte-for-byte identical absolute URLs.

/** Prefix https:// unless the string already starts with http (spec rule §13). */
export function normalizeUrl(url: string): string {
  return url.startsWith('http') ? url : 'https://' + url;
}
