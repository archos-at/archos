'use strict';

const FORMATS = {
  plate: {
    use: 'Section plate: 720 CSS px (or 360/240 at half/third) square',
    compose: 'sq', encode: 'webp', dest: 'out', file: '{base}-{w}', onPage: true,
    sizes: [{ density: 1, w: 720, h: 720, pitch: 3.4 }, { density: 2, w: 1440, h: 1440, pitch: 6.8 }],
  },
  og: {
    use: 'Open Graph / Twitter share card. Platforms scale it, so a coarser screen that survives reduction; PNG because not every scraper reads WebP',
    compose: 'og', encode: 'png', dest: 'out', file: '{base}-og-{w}x{h}',
    sizes: [{ density: 1, w: 1200, h: 630, pitch: 5.0 }],
  },
  banner: {
    use: 'Page or blog-category header, 800 CSS px wide',
    compose: 'wide', encode: 'webp', dest: 'out', file: '{base}-banner-{w}x{h}',
    sizes: [{ density: 1, w: 800, h: 300, pitch: 3.4 }, { density: 2, w: 1600, h: 600, pitch: 6.8 }],
  },
  cover: {
    use: 'Blog post cover, 720 CSS px wide, 16:9',
    compose: 'cover', encode: 'webp', dest: 'out', file: '{base}-cover-{w}x{h}', onPage: true,
    sizes: [{ density: 1, w: 720, h: 405, pitch: 3.4 }, { density: 2, w: 1440, h: 810, pitch: 6.8 }],
  },
  spot: {
    use: 'Spot illustration or icon, 96 CSS px square. Needs its own composition with heavy lines',
    compose: 'spot', encode: 'webp', dest: 'out', file: '{base}-spot-{w}', numeral: false,
    sizes: [{ density: 1, w: 96, h: 96, pitch: 3.4 }, { density: 2, w: 192, h: 192, pitch: 6.8 }],
  },
  release: {
    use: 'Release stamp beside a changelog entry, 64 CSS px square. Its own composition: solid shapes, heavy lines, one screened field at most',
    compose: 'stamp', encode: 'webp', dest: 'out', file: '{base}-{w}', numeral: false, onPage: true,
    sizes: [{ density: 1, w: 64, h: 64, pitch: 2.4 }, { density: 2, w: 128, h: 128, pitch: 4.8 }],
  },
  empty: {
    use: 'Empty state in the product app (apps/workspace), 320 CSS px square. A quiet vignette, not a full plate',
    compose: 'empty', encode: 'webp', dest: 'app', file: '{base}-empty-{w}', numeral: false,
    sizes: [{ density: 1, w: 320, h: 320, pitch: 3.4 }, { density: 2, w: 640, h: 640, pitch: 6.8 }],
  },
  email: {
    use: 'Email signature strip, 600 CSS px wide. Mail clients load it from a public URL, so it must be hosted before use; PNG because Outlook and older clients read no WebP',
    compose: 'strip', encode: 'png', dest: 'out', file: '{base}-email-{w}x{h}', numeral: false,
    sizes: [{ density: 1, w: 600, h: 120, pitch: 3.4 }, { density: 2, w: 1200, h: 240, pitch: 6.8 }],
  },
  social: {
    use: 'Social post, square (Instagram, LinkedIn feed). Platforms recompress, so PNG and the og pitch',
    compose: 'sq', encode: 'png', dest: 'out', file: '{base}-social-{w}',
    sizes: [{ density: 1, w: 1080, h: 1080, pitch: 5.0 }],
  },
  linkedin: {
    use: 'LinkedIn page/profile banner, 4:1',
    compose: 'linkedin', encode: 'png', dest: 'out', file: '{base}-linkedin-{w}x{h}',
    sizes: [{ density: 1, w: 1584, h: 396, pitch: 5.0 }],
  },
  deck: {
    use: 'Full-bleed slide, 16:9 (shares the blog cover composition)',
    compose: 'cover', encode: 'png', dest: 'out', file: '{base}-deck-{w}x{h}',
    sizes: [{ density: 1, w: 1920, h: 1080, pitch: 5.0 }],
  },
  postcard: {
    use: 'A6 portrait postcard at 300 dpi (105 x 148 mm), 60 lpi screen; plus one separation per ink for a riso print shop',
    compose: 'a6', encode: 'png', dest: 'out', file: '{base}-a6-{w}x{h}', separations: true, dpi: 300,
    sizes: [{ density: 1, w: 1240, h: 1748, pitch: 5.0 }],
  },
};
