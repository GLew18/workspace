# Focus music files

Drop your audio files (`.mp3`, `.m4a`, `.ogg`, …) **right here** in `app/public/music/`.

Anything in `app/public/` is served from the site root, so a file at
`app/public/music/lofi.mp3` is reachable at the URL `/music/lofi.mp3`.

## How the app finds them

The built-in track list is in `src/focus/music.ts` → `BUILTIN_TRACKS`. Each row is:

```ts
{ key: 'lofi', label: 'Lofi Beats', emoji: '🎧', src: '/music/lofi.mp3', volume: 45 }
```

- `key`     – a short unique id (the default selection is the one with key `'lofi'`).
- `label`   – the name shown in the picker and the player bar.
- `emoji`   – the little icon next to the label.
- `src`     – the file's URL. For a bundled file use `/music/<filename>`.
- `volume`  – 0–100 (background music usually sits around 40–55).

So the simplest path: name your downloads `lofi.mp3`, `piano.mp3`, `rain.mp3`
(to match the three rows already in `BUILTIN_TRACKS`), drop them here, done.
To use different names/genres, just edit the `src`/`label`/`emoji` in that list.

## Two ways to host the audio

1. **Bundle it here** (this folder). Simple, works offline. Downside: big files
   make the app larger to load/deploy — prefer shorter, loopable tracks.
2. **Host it elsewhere** (e.g. Firebase Storage, which this project already uses)
   and put the full `https://…` URL in `src` instead. Keeps the app small.
