/**
 * The images and the video the pages render from `src/assets/media/`, and how wide the page shows
 * each kind, so that Astro's `<Image>` writes a `srcset` and a phone loads a variant near its own
 * width instead of the master. The masters are kept at full resolution (2560 px long edge at most,
 * WebP quality 92 to 95, sRGB) and are never shrunk by hand: the build makes the variants. Astro
 * hashes the built files, so a replaced master gets a new URL and no cache serves the old one.
 */
import planRevisionChanges from '../assets/media/product-plan-revision-changes.webp';
import searchDerivation from '../assets/media/product-search-derivation.webp';
import compareClearance from '../assets/media/product-compare-clearance.webp';
import modelCheck from '../assets/media/product-model-check.webp';
import floorPlanQuery from '../assets/media/product-floor-plan-query.webp';
import plannerDesign from '../assets/media/planner-design-photo.webp';
import aiSearchCompare from '../assets/media/ai-search-compare-photo.webp';
import teamConversation from '../assets/media/team-conversation-photo.webp';
import demoPanelBackground from '../assets/media/demo-panel-background.webp';
import jonathanUhlemann from '../assets/media/jonathan-uhlemann.webp';
import matthiasBigl from '../assets/media/matthias-bigl.webp';
import ferdinandRubenbauer from '../assets/media/ferdinand-rubenbauer.webp';
import knowledgeVideoPoster from '../assets/media/knowledge-video-poster.webp';
// `?url`: Vite copies the file to /_astro/ under a hashed name, like the images.
import knowledgeVideoMp4 from '../assets/media/knowledge-video.mp4?url';

export const productImages = {
  planRevisionChanges,
  searchDerivation,
  compareClearance,
  modelCheck,
  floorPlanQuery,
};

/** Photos, shown in their own colours: no filter darkens or tints them (text contrast comes from a scrim). */
export const photos = {
  plannerDesign,
  aiSearchCompare,
  teamConversation,
  demoPanelBackground,
};

/** The founders' portraits, in the order of `founders.people` in the home copy. */
export const founderPortraits = [jonathanUhlemann, matthiasBigl, ferdinandRubenbauer];

/** The knowledge animation (German home only) and its poster frame. */
export const knowledgeVideo = {
  poster: knowledgeVideoPoster,
  sources: [{ src: knowledgeVideoMp4, type: 'video/mp4' }],
};

/** Widths built from each 2560 px master. */
export const SCREENSHOT_WIDTHS = [640, 960, 1280, 1920, 2560];

/** Screenshots are text-heavy: keep them sharp. */
export const SCREENSHOT_QUALITY = 85;

/** Widths built from a photo master; Astro leaves out any wider than the master itself. */
export const PHOTO_WIDTHS = [320, 480, 640, 960, 1280, 1600, 1920, 2560];

/** Photos carry fine grain and soft gradients, which banding and blocking show first. */
export const PHOTO_QUALITY = 85;

/**
 * Rendered widths, from the design system's layout (`components.css`): the hero image spans the
 * window less `gutter-wide` (64 px) a side, `gutter-mobile` (16 px) on a phone; a content image
 * spans the container (1280 px less 32 px a side); a gallery card is the container's content
 * width, or the window less 96 px, and below 1024 px its image is 500 px high at 5:2, so 1250 px wide.
 * A duo photo is 7/12 of the container from 1024 px (about 700 px) and 560 px high (440 px on a
 * phone), cropped by `object-fit: cover`, so a landscape photo is drawn wider than its box: the
 * sizes name the drawn width (at most about 750 px, and 600 px on a phone). The quote portrait is
 * `--portrait-width` (440 px); a founder portrait is a third of half the container (about 180 px).
 * The demo panel's photo is half the window from 1024 px, the whole window below.
 */
export const SIZES = {
  hero: '(max-width: 767px) calc(100vw - 32px), calc(100vw - 128px)',
  container: '(max-width: 767px) calc(100vw - 32px), (max-width: 1280px) calc(100vw - 64px), 1216px',
  gallery: '(max-width: 1023px) 1250px, min(1216px, calc(100vw - 96px))',
  duo: '(max-width: 767px) 600px, (max-width: 1023px) calc(100vw - 64px), 750px',
  portrait: '(max-width: 767px) calc(100vw - 32px), 440px',
  founder: '(max-width: 767px) calc(100vw - 32px), (max-width: 1023px) calc((100vw - 96px) / 3), 200px',
  splitPanel: '(max-width: 1023px) 100vw, 50vw',
};
