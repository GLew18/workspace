// WorkSpace — user-made custom playlists (built in Settings, played in Focus).
//
// A playlist is a named, ordered set of library-track ids. It's persisted through
// the Data layer as a focus record keyed "playlist_<id>", so it lives per-user and
// works in both Firebase and the in-memory demo backend.

export interface CustomPlaylist {
  id: string;
  name: string;
  trackIds: string[]; // library track ids, in the user's chosen order
  emoji?: string; // optional user-picked emoji (absent → the 🎵 default)
}

/** A playlist's display emoji — the user's optional pick, else the plain note. */
export const playlistEmoji = (p: CustomPlaylist): string => p.emoji?.trim() || '🎵';

/** Extract + validate custom playlists from a focus record map (getFocusAll). */
export function loadPlaylists(focus: Record<string, unknown>): CustomPlaylist[] {
  return Object.entries(focus)
    .filter(([k]) => k.startsWith('playlist_'))
    .map(([, v]) => v as CustomPlaylist)
    .filter((p) => p && typeof p.id === 'string' && typeof p.name === 'string' && Array.isArray(p.trackIds))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The focus-record key a playlist is stored under. */
export const playlistKey = (id: string): string => `playlist_${id}`;
