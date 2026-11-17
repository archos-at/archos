const motion = matchMedia('screen and (prefers-reduced-motion: no-preference)');
if (motion.matches && 'IntersectionObserver' in window) {
  const inReadingOrder = (a: IntersectionObserverEntry, b: IntersectionObserverEntry) =>
    a.target.compareDocumentPosition(b.target) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
  const showAtOnce = (block: HTMLElement) => {
    block.classList.add('is-instant');
    block.classList.remove('is-pending');
    requestAnimationFrame(() => requestAnimationFrame(() => block.classList.remove('is-instant')));
  };
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
    const counts = new Map<Node | null, number>();
    for (const entry of arriving) {
      const block = entry.target as HTMLElement;
      arrive.unobserve(block);
      const fromBelow = entry.boundingClientRect.top > innerHeight / 2;
      if (first || !fromBelow) {
        showAtOnce(block);
        continue;
      }
      const index = counts.get(block.parentNode) ?? 0;
      counts.set(block.parentNode, index + 1);
      block.style.setProperty('--ui-reveal-index', String(index));
      void ready(block).then(() => {
        if (block.getBoundingClientRect().top < innerHeight / 2) showAtOnce(block);
        else block.classList.remove('is-pending');
      });
    }
    first = false;
  }, { rootMargin: '0px 0px -8% 0px' });
  const ahead = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      ahead.unobserve(entry.target);
      if (entry.target instanceof HTMLImageElement) entry.target.loading = 'eager';
    }
  }, { rootMargin: '0px 0px 100% 0px' });
  for (const block of document.querySelectorAll<HTMLElement>('[data-reveal]')) {
    if (block.getBoundingClientRect().top < innerHeight) continue;
    block.classList.add('is-pending');
    arrive.observe(block);
    if (block.dataset.reveal === 'unveil') ahead.observe(block);
  }
}
