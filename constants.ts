import { BotFeature } from './types';

export const GEMINI_FLASH_MODEL = 'gemini-2.5-flash';
// export const GEMINI_PRO_IMAGE_MODEL = 'gemini-3-pro-image-preview'; // Removed for free API only
export const GEMINI_FLASH_IMAGE_MODEL = 'gemini-2.5-flash-image';
// export const VEO_FAST_GENERATE_MODEL = 'veo-3.1-fast-generate-preview'; // Removed for free API only

export const BOT_FEATURES = [
  {
    id: BotFeature.CHAT,
    name: 'Chat & Story',
    description: 'Engage in free-form chat or generate stories.',
    icon: '💬',
  },
  // {
  //   id: BotFeature.GENERATE_IMAGE,
  //   name: 'Generate Image',
  //   description: 'Create new images based on your prompts.',
  //   icon: '🖼️',
  // },
  {
    id: BotFeature.EDIT_IMAGE,
    name: 'Edit Image',
    description: 'Modify uploaded images with text commands.',
    icon: '✂️',
  },
  // {
  //   id: BotFeature.ANIMATE_IMAGE,
  //   name: 'Animate Image',
  //   description: 'Turn your photos into short videos.',
  //   icon: '🎬',
  // },
  {
    id: BotFeature.DAILY_POST,
    name: 'Daily Post',
    description: 'Generate themed content for daily posts (stories/reels).',
    icon: '🗓️',
  },
  {
    id: BotFeature.SCHEDULE_POST,
    name: 'Schedule Post',
    description: 'Schedule a bot-generated response for a future post.',
    icon: '⏰',
  },
];

export const DAILY_POST_THEMES = [
  { value: 'inspirational', label: 'Inspirational' },
  { value: 'sad', label: 'Sad' },
  { value: 'storytelling', label: 'Storytelling' },
  { value: 'funny', label: 'Funny' },
];

export const DAILY_POST_TYPES = [
  { value: 'story_reel', label: 'Story/Reel' },
  { value: 'regular_post', label: 'Regular Post' },
];

export const BILLING_DOCS_URL = 'ai.google.dev/gemini-api/docs/billing';