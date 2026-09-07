// Cobalt: which OS the browser is running on, for OS-faithful UI.
//
// Exists because the Notifications tab shows MOCKUPS of the real OS popup and a
// troubleshooting guide for the real OS settings app. A Mac student staring at a
// Windows-shaped preview concludes the preview is broken, not that it was drawn
// for someone else's machine (Gabe, 8/31). Detection is cosmetic only: nothing
// functional branches on it, so a wrong guess costs a mismatched illustration,
// never a lost feature. That is also why UNRECOGNIZED reads as 'mac' — the
// userbase is mostly Mac, so the unsure default should match the majority.

/** 'mac' covers macOS AND iOS/iPadOS (the notification look is the Apple one on
 *  both); 'windows' is Windows. Linux/ChromeOS/anything else falls to 'mac'. */
export type DetectedOS = 'mac' | 'windows';

/** Synchronous and cheap on purpose — callers use it mid-render. */
export function detectOS(): DetectedOS {
  // navigator.platform is deprecated but still the most direct signal; the
  // userAgent check backs it up where platform is empty or frozen.
  const platform = navigator.platform || '';
  const ua = navigator.userAgent || '';
  if (/win/i.test(platform) || /Windows/.test(ua)) return 'windows';
  return 'mac';
}
