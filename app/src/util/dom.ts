// WorkSpace — tiny DOM helpers.

type Attrs = Record<string, string | number | boolean | undefined>;

/** Create an element with attributes/classes and children. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: (Node | string)[] = []
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k === 'class') node.className = String(v);
    else if (k === 'text') node.textContent = String(v);
    else if (k.startsWith('data-')) node.setAttribute(k, String(v));
    else if (k in node) (node as any)[k] = v;
    else node.setAttribute(k, String(v));
  }
  for (const c of children) node.append(c);
  return node;
}

/**
 * A single-line-style text box that WRAPS long input instead of scrolling sideways.
 * It's a <textarea> under the hood — only textareas can wrap — styled to look like a
 * normal input via the shared `.ws-textbox` class. Enter is suppressed so it stays
 * one logical line (the caller's own keydown handler still fires, so Enter-to-submit
 * keeps working), and it auto-grows in height to fit the wrapped text, up to a cap,
 * then scrolls. Drop-in for `el('input', { type: 'text', … })`: the returned element
 * exposes `.value` / `.focus()` / `.select()` exactly like an input does.
 */
export function textInput(attrs: Attrs = {}): HTMLTextAreaElement & { rewrap: () => void } {
  const clean: Attrs = { ...attrs, rows: 1 };
  delete clean.type; // a <textarea> has no `type` (and the prop is read-only)
  const ta = el('textarea', clean);
  ta.classList.add('ws-textbox');

  const MAX = 200; // grow to fit up to ~a few lines, then scroll
  const grow = () => {
    if (!ta.isConnected) return; // scrollHeight is only meaningful once it's laid out
    ta.style.height = 'auto';
    const h = ta.scrollHeight;
    if (!h) {
      // Hidden or not laid out yet (a display:none tab panel, a closed dropdown, a
      // mid-mount frame): scrollHeight reads 0 here, and writing THAT as the height
      // squashes the box to a padding sliver that clips its own text. Leave the
      // natural one-row height instead; the visibility observer below re-sizes it
      // the moment it can actually be measured.
      ta.style.height = '';
      ta.style.overflowY = 'hidden';
      return;
    }
    // scrollHeight covers content + padding but NOT the border. These boxes are
    // border-box (the CSS `height` includes the border), so writing scrollHeight
    // straight in leaves the CONTENT area short by the border width — just enough,
    // at this font's line-height, to clip the single line of text along its top
    // edge. Convert scrollHeight into the right `height` for the box-sizing in
    // effect: border-box needs the borders ADDED back; content-box needs the
    // padding removed (scrollHeight counts it, content-box height must not).
    const cs = getComputedStyle(ta);
    const vert = (a: string, b: string) => (parseFloat(cs.getPropertyValue(a)) || 0) + (parseFloat(cs.getPropertyValue(b)) || 0);
    const target =
      cs.boxSizing === 'border-box'
        ? h + vert('border-top-width', 'border-bottom-width')
        : h - vert('padding-top', 'padding-bottom');
    ta.style.height = Math.min(target, MAX) + 'px';
    ta.style.overflowY = target > MAX ? 'auto' : 'hidden';
  };
  ta.addEventListener('input', grow);
  ta.addEventListener('focus', grow);
  // Size boxes that are CREATED hidden (inactive tab panels etc.) once they first
  // become visible — the one moment a real measurement exists. One-shot: after a
  // successful measure, content only changes via input events, which re-grow.
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        grow();
        if (ta.scrollHeight > 0) io.disconnect();
      }
    });
    io.observe(ta);
  }
  // Never insert a newline — this is a one-line field that merely wraps visually.
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') e.preventDefault();
  });
  requestAnimationFrame(grow); // size any pre-filled value once it's in the DOM
  // Expose the height re-fit. Callers that ALSO drive the WIDTH on each keystroke
  // (the inline editors, via autoWidthToText) can re-run this AFTER the width has
  // updated — otherwise the height gets measured at the pre-widen width and a
  // transient wrap leaves the box a blank line too tall.
  const out = ta as HTMLTextAreaElement & { rewrap: () => void };
  out.rewrap = grow;
  return out;
}

/**
 * Copy `source`'s font METRICS onto `target` — size, weight, family, style,
 * line-height, letter-spacing. Deliberately NOT color: typing stays standard
 * legible white even when editing a dim "+ course" placeholder chip. Used by the
 * inline editors so the text never dilates when the edit box appears.
 */
export function copyTextMetrics(target: HTMLElement, source: HTMLElement): void {
  const cs = getComputedStyle(source);
  target.style.fontFamily = cs.fontFamily;
  target.style.fontSize = cs.fontSize;
  target.style.fontWeight = cs.fontWeight;
  target.style.fontStyle = cs.fontStyle;
  target.style.lineHeight = cs.lineHeight;
  target.style.letterSpacing = cs.letterSpacing;
}

/**
 * Keep a one-line editor's width hugging its text ("a bit of padding around the
 * text"). A textarea has NO intrinsic text width — left alone it's an arbitrary
 * ~20-character box — so we measure the text with a hidden same-font <span> and
 * set the width to match (+ slack for caret, padding and border), re-measuring on
 * every keystroke. `.inline-edit-block`'s max-width caps it at the container,
 * where long text wraps and the height auto-grows instead. Call once the editor
 * is CONNECTED (computed styles resolve only in the DOM).
 */
export function autoWidthToText(ta: HTMLTextAreaElement, slack = 16): void {
  const probe = el('span');
  const cs = getComputedStyle(ta);
  probe.style.cssText =
    'position:absolute;visibility:hidden;white-space:pre;' +
    `font:${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize}/${cs.lineHeight} ${cs.fontFamily};` +
    `letter-spacing:${cs.letterSpacing};`;
  const update = () => {
    probe.textContent = ta.value || ta.placeholder || ' ';
    document.body.append(probe);
    ta.style.width = `${Math.ceil(probe.getBoundingClientRect().width) + slack}px`;
    probe.remove();
  };
  ta.addEventListener('input', update);
  update();
}

/** Escape text for safe insertion into innerHTML. */
export const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/** querySelector shorthand. */
export const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T | null =>
  root.querySelector<T>(sel);
