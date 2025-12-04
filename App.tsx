import React, { useState, useRef, useEffect, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import MessageBubble from './components/MessageBubble';
import ImageUpload from './components/ImageUpload';
import ThemeSelector from './components/ThemeSelector';
import {
  generateTextContent,
  generateImage,
  editImage,
  generateVideo,
} from './services/geminiService';
import { Message, BotFeature, ImageSize, VideoAspectRatio, DailyPostTheme, DailyPostType, ScheduledPost } from './types';
import { BOT_FEATURES, DAILY_POST_THEMES, DAILY_POST_TYPES } from './constants';

const App: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [currentFeature, setCurrentFeature] = useState<BotFeature>(BotFeature.CHAT);

  // States for specific features
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [imageSize, setImageSize] = useState<ImageSize>('1K');
  const [videoAspectRatio, setVideoAspectRatio] = useState<VideoAspectRatio>('16:9');
  const [dailyPostTheme, setDailyPostTheme] = useState<DailyPostTheme>('inspirational');
  const [dailyPostType, setDailyPostType] = useState<DailyPostType>('story_reel'); // New state for daily post type

  // States for Schedule Post feature
  const [scheduledPosts, setScheduledPosts] = useState<ScheduledPost[]>([]);
  const [selectedMessageToSchedule, setSelectedMessageToSchedule] = useState<string>(''); // Message ID
  const [scheduledDateTime, setScheduledDateTime] = useState<string>('');

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Load scheduled posts from localStorage on mount
  useEffect(() => {
    try {
      const storedPosts = localStorage.getItem('scheduledPosts');
      if (storedPosts) {
        setScheduledPosts(JSON.parse(storedPosts));
      }
    } catch (e) {
      console.error("Failed to load scheduled posts from localStorage", e);
    }
  }, []);

  // Save scheduled posts to localStorage whenever they change
  useEffect(() => {
    try {
      localStorage.setItem('scheduledPosts', JSON.stringify(scheduledPosts));
    } catch (e) {
      console.error("Failed to save scheduled posts to localStorage", e);
    }
  }, [scheduledPosts]);


  const addMessage = useCallback((message: Message) => {
    setMessages((prevMessages) => [...prevMessages, message]);
  }, []);

  const handleSendMessage = useCallback(async () => {
    if (isLoading) return;

    if (currentFeature !== BotFeature.DAILY_POST && currentFeature !== BotFeature.SCHEDULE_POST && !input.trim()) return;

    // Handle scheduling separately, as it doesn't involve sending input to Gemini
    if (currentFeature === BotFeature.SCHEDULE_POST) {
      if (!selectedMessageToSchedule || !scheduledDateTime) {
        alert('Please select a message and a scheduled date/time.');
        return;
      }
      setIsLoading(true);
      try {
        const messageToSchedule = messages.find(msg => msg.id === selectedMessageToSchedule);
        if (!messageToSchedule || messageToSchedule.role !== 'bot' || messageToSchedule.error) {
          throw new Error('Selected message is not valid for scheduling.');
        }

        let contentType: ScheduledPost['contentType'] = 'text';
        let originalContent = messageToSchedule.content;
        let previewContent = messageToSchedule.content.substring(0, 50) + (messageToSchedule.content.length > 50 ? '...' : '');

        if (messageToSchedule.imageUrl) {
          contentType = 'image';
          originalContent = messageToSchedule.imageUrl;
          previewContent = `Image: ${messageToSchedule.content.substring(0, 30)}...`;
        } else if (messageToSchedule.videoUrl) {
          contentType = 'video';
          originalContent = messageToSchedule.videoUrl;
          previewContent = `Video: ${messageToSchedule.content.substring(0, 30)}...`;
        }

        const newScheduledPost: ScheduledPost = {
          id: uuidv4(),
          messageId: messageToSchedule.id,
          scheduledAt: scheduledDateTime,
          previewContent,
          contentType,
          originalContent,
        };

        setScheduledPosts(prev => [...prev, newScheduledPost].sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()));
        addMessage({
          id: uuidv4(),
          role: 'bot',
          content: `Post scheduled successfully for ${new Date(scheduledDateTime).toLocaleString()}!`,
        });
        setSelectedMessageToSchedule('');
        setScheduledDateTime('');
      } catch (error: any) {
        addMessage({
          id: uuidv4(),
          role: 'bot',
          content: `Failed to schedule post.`,
          error: error.message || 'Unknown error',
        });
      } finally {
        setIsLoading(false);
      }
      return; // Exit here as scheduling is handled
    }

    const userMessage: Message = { id: uuidv4(), role: 'user', content: input };
    addMessage(userMessage);
    setInput('');
    setIsLoading(true);

    try {
      let botResponseContent: Partial<Message> = {};

      switch (currentFeature) {
        case BotFeature.CHAT: {
          const { text, groundingUrls } = await generateTextContent(input, true); // Enable Google Search for general chat
          botResponseContent = { content: text, groundingUrls };
          break;
        }
        case BotFeature.GENERATE_IMAGE: {
          botResponseContent.content = `Generating a ${imageSize} image for: "${input}"...`;
          addMessage({ id: uuidv4(), role: 'bot', ...botResponseContent });
          const imageUrl = await generateImage(input, imageSize);
          botResponseContent = { content: `Here is your generated image for "${input}":`, imageUrl };
          break;
        }
        case BotFeature.EDIT_IMAGE: {
          if (!selectedImage) {
            botResponseContent.error = 'Please upload an image to edit.';
            break;
          }
          botResponseContent.content = `Editing your image with: "${input}"... This might take a moment.`;
          addMessage({ id: uuidv4(), role: 'bot', ...botResponseContent });
          const editedImageUrl = await editImage(selectedImage, input);
          botResponseContent = { content: `Here is your edited image for "${input}":`, imageUrl: editedImageUrl };
          break;
        }
        case BotFeature.ANIMATE_IMAGE: {
          botResponseContent.content = `Generating a ${videoAspectRatio} video with${selectedImage ? ' your image and ' : ' '}prompt "${input}"... This can take a few minutes.`;
          addMessage({ id: uuidv4(), role: 'bot', ...botResponseContent });
          const videoUrl = await generateVideo(selectedImage, input, videoAspectRatio);
          botResponseContent = { content: `Here is your generated video:`, videoUrl };
          break;
        }
        case BotFeature.DAILY_POST: {
          let prompt = '';
          if (dailyPostType === 'story_reel') {
            prompt = `Generate a short ${dailyPostTheme} themed story or inspirational message suitable for a social media reel/story. Keep it concise, around 100-150 words.`;
          } else { // regular_post
            prompt = `Generate a detailed ${dailyPostTheme} themed story or message suitable for a regular social media post. Make it engaging and provide a clear narrative or insightful reflection, around 200-300 words.`;
          }
          const { text, groundingUrls } = await generateTextContent(prompt);
          botResponseContent = { content: `Daily Post (${dailyPostTheme} - ${dailyPostType.replace('_', ' ')}):\n\n${text}`, groundingUrls };
          break;
        }
      }

      // If no error occurred during feature-specific logic, add the final bot message
      if (!botResponseContent.error) {
        addMessage({ id: uuidv4(), role: 'bot', ...botResponseContent });
      } else {
        addMessage({ id: uuidv4(), role: 'bot', content: 'An error occurred.', error: botResponseContent.error });
      }
    } catch (error: any) {
      console.error('API Error:', error);
      addMessage({
        id: uuidv4(),
        role: 'bot',
        content: `Sorry, something went wrong.`,
        error: error.message || 'Please try again later.',
      });
    } finally {
      setIsLoading(false);
      // For image/video features, reset selected image after successful operation
      if (currentFeature === BotFeature.EDIT_IMAGE || currentFeature === BotFeature.ANIMATE_IMAGE) {
        setSelectedImage(null);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, isLoading, currentFeature, selectedImage, imageSize, videoAspectRatio, dailyPostTheme, dailyPostType, selectedMessageToSchedule, scheduledDateTime, messages, addMessage]);

  const handleClearImage = useCallback(() => {
    setSelectedImage(null);
  }, []);

  const getBotMessagesForScheduling = useCallback(() => {
    // Filter for bot messages that are not errors and have actual content/image/video
    return messages.filter(msg =>
      msg.role === 'bot' &&
      !msg.error &&
      (msg.content.trim() !== '...thinking...' || msg.imageUrl || msg.videoUrl)
    );
  }, [messages]);

  const renderFeatureInput = () => {
    switch (currentFeature) {
      case BotFeature.GENERATE_IMAGE:
        return (
          <div className="flex flex-col gap-2 p-2 bg-gray-50 rounded-md">
            <label className="text-sm font-medium text-gray-700">Image Size:</label>
            <div className="flex gap-2">
              {(['1K', '2K', '4K'] as ImageSize[]).map((size) => (
                <button
                  key={size}
                  onClick={() => setImageSize(size)}
                  className={`px-3 py-1 rounded-md text-sm font-medium ${
                    imageSize === size ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                  } disabled:opacity-50`}
                  disabled={isLoading}
                >
                  {size}
                </button>
              ))}
            </div>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
              placeholder="Describe the image you want to create (e.g., 'A robot riding a skateboard')"
              className="p-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
              disabled={isLoading}
            />
            <button
              onClick={handleSendMessage}
              className="bg-blue-600 text-white p-2 rounded-md hover:bg-blue-700 transition-colors duration-200 disabled:opacity-50"
              disabled={isLoading}
            >
              {isLoading ? 'Generating...' : 'Generate Image'}
            </button>
          </div>
        );
      case BotFeature.EDIT_IMAGE:
        return (
          <div className="flex flex-col gap-2 p-2 bg-gray-50 rounded-md">
            <ImageUpload onImageSelected={setSelectedImage} isLoading={isLoading} clearImage={handleClearImage} />
            {selectedImage && (
              <>
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
                  placeholder="How do you want to edit the image? (e.g., 'Add a retro filter')"
                  className="p-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                  disabled={isLoading}
                />
                <button
                  onClick={handleSendMessage}
                  className="bg-blue-600 text-white p-2 rounded-md hover:bg-blue-700 transition-colors duration-200 disabled:opacity-50"
                  disabled={isLoading || !selectedImage}
                >
                  {isLoading ? 'Editing...' : 'Edit Image'}
                </button>
              </>
            )}
          </div>
        );
      case BotFeature.ANIMATE_IMAGE:
        return (
          <div className="flex flex-col gap-2 p-2 bg-gray-50 rounded-md">
            <ImageUpload onImageSelected={setSelectedImage} isLoading={isLoading} clearImage={handleClearImage} />
            <label className="text-sm font-medium text-gray-700">Aspect Ratio:</label>
            <div className="flex gap-2">
              {(['16:9', '9:16'] as VideoAspectRatio[]).map((ratio) => (
                <button
                  key={ratio}
                  onClick={() => setVideoAspectRatio(ratio)}
                  className={`px-3 py-1 rounded-md text-sm font-medium ${
                    videoAspectRatio === ratio ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                  } disabled:opacity-50`}
                  disabled={isLoading}
                >
                  {ratio}
                </button>
              ))}
            </div>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
              placeholder="Optional: Describe the animation (e.g., 'A cat driving fast')"
              className="p-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
              disabled={isLoading}
            />
            <button
              onClick={handleSendMessage}
              className="bg-blue-600 text-white p-2 rounded-md hover:bg-blue-700 transition-colors duration-200 disabled:opacity-50"
              disabled={isLoading}
            >
              {isLoading ? 'Animating...' : 'Animate Image'}
            </button>
          </div>
        );
      case BotFeature.DAILY_POST:
        return (
          <div className="flex flex-col gap-2 p-2 bg-gray-50 rounded-md">
            <ThemeSelector selectedTheme={dailyPostTheme} onThemeChange={setDailyPostTheme} isLoading={isLoading} />
            <div className="flex items-center gap-2">
              <label className="text-gray-700 font-medium">Post Type:</label>
              {DAILY_POST_TYPES.map((type) => (
                <div key={type.value} className="flex items-center">
                  <input
                    type="radio"
                    id={`post-type-${type.value}`}
                    name="daily-post-type"
                    value={type.value}
                    checked={dailyPostType === type.value}
                    onChange={() => setDailyPostType(type.value as DailyPostType)}
                    disabled={isLoading}
                    className="mr-1"
                  />
                  <label htmlFor={`post-type-${type.value}`} className="text-sm">{type.label}</label>
                </div>
              ))}
            </div>
            <p className="text-sm text-gray-600">
              Click below to generate a new post based on the selected theme and type.
            </p>
            <button
              onClick={handleSendMessage}
              className="bg-blue-600 text-white p-2 rounded-md hover:bg-blue-700 transition-colors duration-200 disabled:opacity-50"
              disabled={isLoading}
            >
              {isLoading ? 'Generating Post...' : 'Generate Daily Post'}
            </button>
          </div>
        );
      case BotFeature.SCHEDULE_POST:
        const botResponses = getBotMessagesForScheduling();
        const now = new Date();
        const minDateTime = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

        return (
          <div className="flex flex-col gap-4 p-2 bg-gray-50 rounded-md">
            <h3 className="text-lg font-semibold text-gray-800">Schedule a Post</h3>
            {botResponses.length > 0 ? (
              <>
                <div className="flex flex-col gap-2">
                  <label htmlFor="message-select" className="text-sm font-medium text-gray-700">Select Bot Response:</label>
                  <select
                    id="message-select"
                    value={selectedMessageToSchedule}
                    onChange={(e) => setSelectedMessageToSchedule(e.target.value)}
                    disabled={isLoading}
                    className="p-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                  >
                    <option value="">-- Select a message --</option>
                    {botResponses.map((msg) => (
                      <option key={msg.id} value={msg.id}>
                        {msg.imageUrl ? 'Image: ' : msg.videoUrl ? 'Video: ' : ''}
                        {msg.content.substring(0, 70)}{msg.content.length > 70 ? '...' : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-2">
                  <label htmlFor="schedule-datetime" className="text-sm font-medium text-gray-700">Scheduled Time:</label>
                  <input
                    type="datetime-local"
                    id="schedule-datetime"
                    value={scheduledDateTime}
                    onChange={(e) => setScheduledDateTime(e.target.value)}
                    min={minDateTime}
                    disabled={isLoading}
                    className="p-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                  />
                </div>
                <button
                  onClick={handleSendMessage}
                  className="bg-blue-600 text-white p-2 rounded-md hover:bg-blue-700 transition-colors duration-200 disabled:opacity-50"
                  disabled={isLoading || !selectedMessageToSchedule || !scheduledDateTime}
                >
                  {isLoading ? 'Scheduling...' : 'Schedule Post'}
                </button>
              </>
            ) : (
              <p className="text-sm text-gray-600">Generate some bot responses first to schedule them!</p>
            )}

            <p className="text-xs text-gray-500 italic">
              Note: This is a frontend-only simulation. Posts are scheduled locally and are not actually published to social media.
            </p>

            <div className="mt-4">
              <h4 className="text-md font-semibold text-gray-800">Upcoming Scheduled Posts:</h4>
              {scheduledPosts.length > 0 ? (
                <ul className="mt-2 space-y-2 text-sm text-gray-700">
                  {scheduledPosts.map((post) => (
                    <li key={post.id} className="p-2 bg-white border border-gray-200 rounded-md shadow-sm">
                      <p className="font-medium">
                        {new Date(post.scheduledAt).toLocaleString()}:
                      </p>
                      <p className="text-gray-600">
                        {post.contentType === 'image' && '🖼️ '}
                        {post.contentType === 'video' && '🎬 '}
                        {post.previewContent}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-gray-600">No posts scheduled yet.</p>
              )}
            </div>
          </div>
        );
      case BotFeature.CHAT:
      default:
        return (
          <div className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
              placeholder="Type your message here..."
              className="flex-grow p-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
              disabled={isLoading}
            />
            <button
              onClick={handleSendMessage}
              className="bg-blue-600 text-white p-2 rounded-md hover:bg-blue-700 transition-colors duration-200 disabled:opacity-50"
              disabled={isLoading}
            >
              {isLoading ? 'Sending...' : 'Send'}
            </button>
          </div>
        );
    }
  };

  return (
    <div className="flex flex-col w-full max-w-2xl h-[90vh] bg-white rounded-lg shadow-xl overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-600 to-indigo-700 text-white p-4 text-center text-xl font-bold">
        Gemini Reels & Stories Bot
      </div>

      {/* Feature Selector */}
      <div className="flex flex-wrap gap-2 p-3 bg-gray-50 border-b border-gray-200 justify-center">
        {BOT_FEATURES.map((feature) => (
          <button
            key={feature.id}
            onClick={() => {
              setCurrentFeature(feature.id);
              setInput(''); // Clear input when switching feature
              setSelectedImage(null); // Clear image when switching features
              setSelectedMessageToSchedule(''); // Clear scheduling selection
              setScheduledDateTime(''); // Clear scheduled date/time
            }}
            className={`flex items-center gap-1 px-3 py-1 rounded-full text-sm font-medium transition-colors duration-200
              ${currentFeature === feature.id
                ? 'bg-blue-600 text-white shadow-md'
                : 'bg-gray-200 text-gray-800 hover:bg-gray-300'}
              disabled:opacity-50 disabled:cursor-not-allowed`}
            disabled={isLoading}
            title={feature.description}
          >
            {feature.icon} {feature.name}
          </button>
        ))}
      </div>

      {/* Chat Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-100">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-gray-300 text-gray-800 p-3 my-2 rounded-xl rounded-bl-none shadow-md">
              <span className="animate-pulse">...thinking...</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area (sticky footer) */}
      <div className="sticky bottom-0 p-4 bg-white border-t border-gray-200 shadow-lg">
        {renderFeatureInput()}
      </div>
    </div>
  );
};

export default App;