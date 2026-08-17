// Cobalt: the global "nothing should make a sound right now" switch.
//
// The landing page's hero demo drives the REAL app with a ghost cursor that
// dispatches real DOM events, so the app underneath cannot tell a scripted click
// from a person's. That is the whole point of the demo, and it is also how a
// scripted check-off ended up ringing the real completion chime on a loop, on the
// landing page, with no way for a visitor to turn it off (Gabe, 8/15).
//
// Gated HERE rather than in each demo, and consulted by every sound the app can
// make rather than just the one that misbehaved, because there will be more
// animations and the next one must be silent without anybody remembering to make
// it so. A new sound is only correct if it asks this first.
//
// This is NOT a preference. It describes who is clicking, which is not the
// student's business and must not be overridable from Settings.

let silent = 0; // a COUNT, so two overlapping demos can't un-mute each other

/** Raise or lower the mute. Balanced calls: every `true` needs its `false`. */
export function setDemoSilent(on: boolean): void {
  silent = on ? silent + 1 : Math.max(0, silent - 1);
}

/** Every sound-producing function in the app checks this before it makes noise. */
export function isDemoSilent(): boolean {
  return silent > 0;
}
