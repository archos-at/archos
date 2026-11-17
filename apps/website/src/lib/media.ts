import planRevisionChanges from '../assets/media/product-plan-revision-changes.webp';
import searchDerivation from '../assets/media/product-search-derivation.webp';
import compareClearance from '../assets/media/product-compare-clearance.webp';
import modelCheck from '../assets/media/product-model-check.webp';
import floorPlanQuery from '../assets/media/product-floor-plan-query.webp';
import plannerDesign from '../assets/media/planner-design-photo.webp';
import aiSearchCompare from '../assets/media/ai-search-compare-photo.webp';
import feld72Team from '../assets/media/feld72-team-photo.webp';
import demoPanelBackground from '../assets/media/demo-panel-background.webp';
import jonathanUhlemann from '../assets/media/jonathan-uhlemann.webp';
import matthiasBigl from '../assets/media/matthias-bigl.webp';
import ferdinandRubenbauer from '../assets/media/ferdinand-rubenbauer.webp';
import knowledgeVideoPoster from '../assets/media/knowledge-video-poster.webp';
import knowledgeVideoMp4 from '../assets/media/knowledge-video.mp4?url';

export const productImages = {
  planRevisionChanges,
  searchDerivation,
  compareClearance,
  modelCheck,
  floorPlanQuery,
};

export const photos = {
  plannerDesign,
  aiSearchCompare,
  feld72Team,
  demoPanelBackground,
};

export const founderPortraits = [jonathanUhlemann, matthiasBigl, ferdinandRubenbauer];

export const knowledgeVideo = {
  poster: knowledgeVideoPoster,
  sources: [{ src: knowledgeVideoMp4, type: 'video/mp4' }],
};

export const SCREENSHOT_WIDTHS = [640, 960, 1280, 1920, 2560, 3200, 3840];

export const SCREENSHOT_QUALITY = 85;

export const PHOTO_WIDTHS = [320, 480, 640, 960, 1280, 1600, 1920, 2560, 3200, 3840];

export const PHOTO_QUALITY = 85;

export const SIZES = {
  hero: '(max-width: 767px) calc(100vw - 32px), calc(100vw - 128px)',
  container: '(max-width: 767px) calc(100vw - 32px), (max-width: 1280px) calc(100vw - 64px), 1216px',
  gallery: '(max-width: 1023px) 1250px, min(1216px, calc(100vw - 96px))',
  duo: '(max-width: 767px) 600px, (max-width: 1023px) calc(100vw - 64px), 750px',
  portrait: '(max-width: 767px) calc(100vw - 32px), 440px',
  quoteWide: '(max-width: 767px) calc(100vw - 32px), (max-width: 1023px) calc(100vw - 64px), 680px',
  founder: '(max-width: 767px) calc(100vw - 32px), (max-width: 1023px) calc((100vw - 96px) / 3), 200px',
  splitPanel: '(max-width: 1023px) 100vw, 50vw',
};
