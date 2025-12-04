export type MessageRole = 'user' | 'bot';

export interface Message {
  id: string;
  role: MessageRole;
  content: string; // Text content
  imageUrl?: string; // For images sent by bot
  videoUrl?: string; // For videos sent by bot
  error?: string; // For error messages
  groundingUrls?: GroundingUrl[]; // For grounding URLs
}

export interface GroundingUrl {
  uri: string;
  title?: string;
}

export enum BotFeature {
  CHAT = 'chat',
  // GENERATE_IMAGE = 'generate_image', // Removed for free API only
  EDIT_IMAGE = 'edit_image',
  // ANIMATE_IMAGE = 'animate_image', // Removed for free API only
  DAILY_POST = 'daily_post',
  SCHEDULE_POST = 'schedule_post', // New feature for scheduling posts
}

// export type ImageSize = '1K' | '2K' | '4K'; // Removed for free API only
// export type VideoAspectRatio = '16:9' | '9:16'; // Removed for free API only
export type DailyPostTheme = 'inspirational' | 'sad' | 'storytelling' | 'funny';
export type DailyPostType = 'story_reel' | 'regular_post'; // New type for daily post variations

export interface ScheduledPost {
  id: string;
  messageId: string; // ID of the original bot message
  scheduledAt: string; // ISO 8601 string for date and time
  previewContent: string; // A snippet of the content for display
  contentType: 'text' | 'image' | 'video'; // Type of content being scheduled
  originalContent: string; // Full content string or URL for images/videos
}