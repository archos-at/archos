/**
 * Arrival on scroll: blocks marked [data-reveal] below the fold arrive once as they scroll
 * into view (styles in packages/brand/css/motion.css, which also holds the hero's entrance
 * on load). Anything on screen at load is left alone, and reduced motion or print leaves the
 * page as it is. Imported by BaseLayout.astro, so Astro bundles it (CSP `script-src 'self'`).
 *
 * The siblings that come into view together each get their index in reading order
 * (`--ui-reveal-index`), so a row of tiles arrives left to right and a tile that arrives
 * alone does not wait. A block the reader did not scroll down onto (already in view when
 * the observer first reports, reached by scrolling back up, an anchor, find in page) is
 * shown at once.
 */
const motion = matchMedia('screen and (prefers-reduced-motion: no-preference)');
if (motion.matches && 'IntersectionObserver' in window) {
  const inReadingOrder = (a: IntersectionObserverEntry, b: IntersectionObserverEntry) =>
    a.target.compareDocumentPosition(b.target) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
  const showAtOnce = (block: HTMLElement) => {
    block.classList.add('is-instant');
    block.classList.remove('is-pending');
    // Kept for a frame, so the style change lands without a transition.
    requestAnimationFrame(() => requestAnimationFrame(() => block.classList.remove('is-instant')));
  };
  // An image is uncovered only once it can be shown, or the wipe would uncover its grey
  // placeholder and the picture would pop in after it. Waits at most IMAGE_WAIT_MS, so
  // a slow image never holds back the text around it.
  const IMAGE_WAIT_MS = 400;
  const ready = (block: HTMLElement) => {
    const images = [...(block instanceof HTMLImageElement ? [block] : block.querySelectorAll('img'))].filter((img) => {
      const box = img.getBoundingClientRect();
      return !img.complete && box.right > 0 && box.left < innerWidth;
    });
    if (images.length === 0) return Promise.resolve();
    const decoded = Promise.all(images.map((img) => img.decode().catch(() => undefined)));
    return Promise.race([decoded, new Promise((resolve) => setTimeout(resolve, IMAGE_WAIT_MS))]);
  };
  let first = true;
  const arrive = new IntersectionObserver((entries) => {
    const arriving = entries.filter((entry) => entry.isIntersecting).sort(inReadingOrder);
    // The stagger counts among siblings (the tiles of one grid, the steps of one
    // timeline); unrelated blocks arriving together start together.
    const counts = new Map<Node | null, number>();
    for (const entry of arriving) {
      const block = entry.target as HTMLElement;
      arrive.unobserve(block);
      // Scrolling down, a block is first seen entering at the bottom. One first seen
      // higher up was reached another way (scrolling back up, a fling, find in page) and
      // the reader is already looking at it.
      const fromBelow = entry.boundingClientRect.top > innerHeight / 2;
      if (first || !fromBelow) {
        showAtOnce(block);
        continue;
      }
      const index = counts.get(block.parentNode) ?? 0;
      counts.set(block.parentNode, index + 1);
      block.style.setProperty('--ui-reveal-index', String(index));
      void ready(block).then(() => block.classList.remove('is-pending'));
    }
    first = false;
  }, { rootMargin: '0px 0px -8% 0px' });
  for (const block of document.querySelectorAll<HTMLElement>('[data-reveal]')) {
    if (block.getBoundingClientRect().top < innerHeight) continue;
    block.classList.add('is-pending');
    arrive.observe(block);
  }
}
