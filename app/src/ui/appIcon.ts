// Cobalt: the two REAL icons the notification mockups depend on, shared by the
// settings preview (settings/view.ts) and the troubleshooting-guide slides
// (settings/notifyGuides.ts). One source, because the guide toasts must look
// IDENTICAL to the preview toast (Gabe, 8/31): the stylized flat gem the slides
// used before read as a cartoon next to the real app icon.

/** The Chrome roundel's inner markup, the OFFICIAL logo geometry (Feb-2022 icon:
 *  red top, yellow lower-right, green lower-left, white ring, blue core) with
 *  the gradients flattened to the brand colors. Coordinates live in a 48-box;
 *  wrap it in an <svg viewBox="0 0 48 48"> or a scaled <g>. No ids, so it can
 *  repeat freely in one document. */
export const CHROME_LOGO_INNER =
  '<circle cx="24" cy="24" r="12" fill="#fff"/>' +
  '<path d="M24 12h20.78A24 24 0 0 0 3.22 12l10.39 18A12 12 0 0 1 24 12Z" fill="#ea4335"/>' +
  '<path d="M34.39 30 24 48a24 24 0 0 0 20.78-36H24a12 12 0 0 1 10.39 18Z" fill="#fbbc04"/>' +
  '<path d="M13.61 30 3.22 12A24 24 0 0 0 24 48l10.39-18a12 12 0 0 1-20.78 0Z" fill="#34a853"/>' +
  '<circle cx="24" cy="24" r="9.5" fill="#1a73e8"/>';

/** The Chrome roundel as a complete <svg>. `attrs` lands on the root tag —
 *  pass x/y/width/height to nest it inside another SVG scene. */
export const chromeIconSvg = (attrs = ''): string =>
  `<svg ${attrs} viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${CHROME_LOGO_INNER}</svg>`;

/** The REAL Cobalt app icon (navy square + the cobalt gem; the monitor retired
 *  8/10), matching public/icons/icon.svg. It carries gradient/clip defs, so ids
 *  take a per-call suffix: two copies with the SAME suffix render identically,
 *  but give each distinct mount a distinct suffix to keep the document clean.
 *  `attrs` lands on the root tag (x/y/width/height for nesting in a scene). */
export const cobaltIconSvg = (idSuffix: string, attrs = ''): string => {
  const id = (n: string): string => `si-${n}-${idSuffix}`;
  return (
    `<svg ${attrs} viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><rect x="0" y="0" width="120" height="120" rx="26" fill="#0e1e42"/>` +
    `<defs><clipPath id="${id('clip')}"><rect x="9" y="9" width="82" height="82" rx="31" ry="31"/></clipPath>` +
    `<radialGradient id="${id('body')}" cx="36%" cy="30%" r="88%"><stop offset="0%" stop-color="#8cc0ff"/><stop offset="38%" stop-color="#3d7fe8"/><stop offset="68%" stop-color="#0b46b0"/><stop offset="100%" stop-color="#032154"/></radialGradient>` +
    `<radialGradient id="${id('glow')}" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#7db4ff" stop-opacity="0.55"/><stop offset="100%" stop-color="#7db4ff" stop-opacity="0"/></radialGradient>` +
    `<linearGradient id="${id('sheen')}" x1="0%" y1="0%" x2="70%" y2="70%"><stop offset="0%" stop-color="#ffffff" stop-opacity="0.48"/><stop offset="42%" stop-color="#ffffff" stop-opacity="0"/></linearGradient></defs>` +
    `<g transform="translate(10 10)"><g clip-path="url(#${id('clip')})">` +
    `<rect x="9" y="9" width="82" height="82" fill="url(#${id('body')})"/>` +
    '<polygon points="38,34 62,34 74,6 26,6" fill="#ffffff" opacity="0.14"/><polygon points="62,34 70,44 96,30 74,6" fill="#02174a" opacity="0.24"/>' +
    '<polygon points="70,44 70,58 96,72 96,30" fill="#ffffff" opacity="0.10"/><polygon points="70,58 62,66 74,96 96,72" fill="#02174a" opacity="0.38"/>' +
    '<polygon points="62,66 38,66 26,96 74,96" fill="#02174a" opacity="0.20"/><polygon points="38,66 30,58 4,72 26,96" fill="#02174a" opacity="0.32"/>' +
    '<polygon points="30,58 30,44 4,30 4,72" fill="#ffffff" opacity="0.13"/><polygon points="30,44 38,34 26,6 4,30" fill="#ffffff" opacity="0.22"/>' +
    '<polygon points="38,34 62,34 70,44 70,58 62,66 38,66 30,44" fill="#4a8cf0" opacity="0.50"/>' +
    `<ellipse cx="41" cy="58" rx="16" ry="12" fill="url(#${id('glow')})"/><path d="M9,9 h52 q-32,13 -42,46 z" fill="url(#${id('sheen')})"/>` +
    '<path d="M36 19 l2.6 4.6 4.6 2.6 -4.6 2.6 -2.6 4.6 -2.6 -4.6 -4.6 -2.6 4.6 -2.6 Z" fill="#ffffff" opacity="0.95"/>' +
    '<circle cx="64" cy="61" r="1.8" fill="#ffffff" opacity="0.6"/><circle cx="57" cy="20" r="1.3" fill="#ffffff" opacity="0.5"/>' +
    '</g></g></svg>'
  );
};
