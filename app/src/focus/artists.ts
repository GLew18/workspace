// Cobalt: artist grouping over the focus music library.
//
// library.ts is GENERATED (don't hand-edit it), so the "organize by artist" view
// lives here. A track's PRIMARY artist is its first composer (authors[0]); e.g.
// "Bach, Siloti" groups under Bach. Artist playlists span genres.

import { LIBRARY_TRACKS, type LibraryTrack } from './library';

/** The primary composer a track is filed under — the DISPLAY name (surname-only
 *  for ambient artists), so "Buckley" groups and labels like "Bach" does. */
export function primaryArtist(t: LibraryTrack): string {
  return t.authorsShort[0] ?? t.authors[0] ?? 'Unknown';
}

/** Every artist in the library, alphabetized, each with its track count. */
export function musicArtists(): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const t of LIBRARY_TRACKS) {
    const a = primaryArtist(t);
    counts.set(a, (counts.get(a) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** An artist's tracks (across genres), in library order. */
export function tracksForArtist(artist: string): LibraryTrack[] {
  return LIBRARY_TRACKS.filter((t) => primaryArtist(t) === artist);
}

// Artists with few tracks clutter the list, so any with ≤ MINOR_MAX songs are
// pooled into a single "Various" collection instead of each getting a row.
export const MINOR_MAX = 3;

/** Artists with more than MINOR_MAX tracks — the ones worth their own row, sorted
 *  by song count (most first). */
export function majorArtists(): { name: string; count: number }[] {
  return musicArtists()
    .filter((a) => a.count > MINOR_MAX)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/** True if any artist has ≤ MINOR_MAX tracks (i.e. a "Various" bucket is warranted). */
export function hasMinorArtists(): boolean {
  return musicArtists().some((a) => a.count <= MINOR_MAX);
}

/** All tracks by artists with ≤ MINOR_MAX songs, pooled — the "Various" playlist. */
export function minorArtistTracks(): LibraryTrack[] {
  const minor = new Set(musicArtists().filter((a) => a.count <= MINOR_MAX).map((a) => a.name));
  return LIBRARY_TRACKS.filter((t) => minor.has(primaryArtist(t)));
}
