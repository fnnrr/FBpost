import { BotFeature, PrebuiltVoice } from './types';

export const GEMINI_FLASH_MODEL = 'gemini-2.5-flash';
export const GEMINI_FLASH_IMAGE_MODEL = 'gemini-2.5-flash-image';
export const GEMINI_FLASH_TTS_MODEL = 'gemini-2.5-flash-preview-tts';

export const BOT_FEATURES = [
  {
    id: BotFeature.CHAT,
    name: 'Chat & Story',
    description: 'Engage in free-form chat or generate stories.',
    icon: '💬',
  },
  {
    id: BotFeature.EDIT_IMAGE,
    name: 'Edit Image',
    description: 'Modify uploaded images with text commands.',
    icon: '✂️',
  },
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
  {
    id: BotFeature.CREATE_STORY,
    name: 'Create Story',
    description: 'Generate a creative story with optional voice and song suggestions.',
    icon: '📝',
  },
  {
    id: BotFeature.DATA_MANAGEMENT,
    name: 'Data Mgmt',
    description: 'Manage your local data or learn how to delete Messenger data.',
    icon: '🗑️',
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

export const TTS_VOICES = [
  { value: PrebuiltVoice.KORE, label: 'Kore (Female)' },
  { value: PrebuiltVoice.PUCK, label: 'Puck (Male)' },
  { value: PrebuiltVoice.ZEPHYR, label: 'Zephyr (Female)' },
  { value: PrebuiltVoice.CHARON, label: 'Charon (Male)' },
  { value: PrebuiltVoice.FENRIR, label: 'Fenrir (Male)' },
];

export const BILLING_DOCS_URL = 'ai.google.dev/gemini-api/docs/billing';
export const FB_APP_SECRET = process.env.FB_APP_SECRET; 
export const FB_PAGE_ID = process.env.FB_PAGE_ID; 
export const FB_PAGE_ACCESS_TOKEN = process.env.FB_PAGE_ACCESS_TOKEN;