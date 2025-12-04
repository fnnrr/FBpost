import React, { useState, useRef, useEffect, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import MessageBubble from './components/MessageBubble';
import ImageUpload from './components/ImageUpload';
import ThemeSelector from './components/ThemeSelector';
import PrivacyPolicy from './components/PrivacyPolicy';
import TermsOfService from './components/TermsOfService';
import {
  generateTextContent,
  editImage,
  generateImageFromText,
} from './services/geminiService';
import { Message, BotFeature, DailyPostTheme, DailyPostType, ScheduledPost, PrebuiltVoice } from './types';
import { BOT_FEATURES, DAILY_POST_THEMES, DAILY_POST_TYPES, TTS_VOICES } from './constants';

const App: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false); 
  const [isPosting, setIsPosting] = useState<boolean>(false); 
  const [isPublishingToFacebook, setIsPublishingToFacebook] = useState<boolean>(false);
  const [currentFeature, setCurrentFeature] = useState<BotFeature>(BotFeature.CHAT);
  const [showPrivacyPolicy, setShowPrivacyPolicy] = useState<boolean>(false);
  const [showTermsOfService, setShowTermsOfService] = useState<boolean>(false);

  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [dailyPostTheme, setDailyPostTheme] = useState<DailyPostTheme>('inspirational');
  const [dailyPostType, setDailyPostType] = useState<DailyPostType>('story_reel');
  const [enableDailyPostTTS, setEnableDailyPostTTS] = useState<boolean>(false);
  const [selectedDailyPostVoice, setSelectedDailyPostVoice] = useState<PrebuiltVoice>(PrebuiltVoice.ZEPHYR);

  const [storyTheme, setStoryTheme] = useState<DailyPostTheme>('inspirational');
  // enableStoryTTS removed as it is now always on for Stories
  const [selectedStoryVoice, setSelectedStoryVoice] = useState<PrebuiltVoice>(PrebuiltVoice.ZEPHYR);
  const [enableSongSuggestion, setEnableSongSuggestion] = useState<boolean>(false);

  const [scheduledPosts, setScheduledPosts] = useState<ScheduledPost[]>([]);
  const [selectedMessageToSchedule, setSelectedMessageToSchedule] = useState<string>('');
  const [scheduledDateTime, setScheduledDateTime] = useState<string>('');

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

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

  useEffect(() => {
    try {
      localStorage.setItem('scheduledPosts', JSON.stringify(scheduledPosts));
    } catch (e) {
      console.error("Failed to save scheduled posts to localStorage", e);
    }
  }, [scheduledPosts]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const path = window.location.pathname;

    if (params.get('show') === 'privacy' || path === '/privacy-policy') {
      setShowPrivacyPolicy(true);
    } else if (params.get('show') === 'terms' || path === '/terms-of-service') {
      setShowTermsOfService(true);
    }

    if (window.location.search.includes('?show=')) {
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  const addMessage = useCallback((message: Message) => {
    setMessages((prevMessages) => [...prevMessages, message]);
  }, []);

  const handleClearLocalScheduledPosts = useCallback(() => {
    if (window.confirm('Are you sure you want to clear ALL locally stored scheduled posts? This action cannot be undone.')) {
      try {
        localStorage.removeItem('scheduledPosts');
        setScheduledPosts([]);
        addMessage({
          id: uuidv4(),
          role: 'bot',
          content: 'All local scheduled posts have been cleared from your browser.',
        });
      } catch (error: any) {
        addMessage({
          id: uuidv4(),
          role: 'bot',
          content: 'Failed to clear local scheduled posts.',
          error: error.message || 'Unknown error',
        });
      }
    }
  }, [addMessage]);

  const handlePublishToFacebook = useCallback(async (message: Message) => {
    if (!message.content && !message.imageUrl) {
      addMessage({ id: uuidv4(), role: 'bot', content: 'Cannot publish an empty message or unsupported content type to Facebook.', error: 'Unsupported content for Facebook publishing.' });
      return;
    }

    setIsPublishingToFacebook(true);
    addMessage({ id: uuidv4(), role: 'bot', content: "Publishing to Facebook Page..." });

    try {
      const payload: { text: string; imageUrl?: string; videoUrl?: string } = {
        text: message.content,
      };
      if (message.imageUrl) {
        payload.imageUrl = message.imageUrl;
      }
      
      // Note: Netlify Functions are served at /.netlify/functions/
      const response = await fetch('/.netlify/functions/publishToFacebookPage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage = `Server status ${response.status}`;
        try {
            const errorJson = JSON.parse(errorText);
            if (errorJson.error) errorMessage = errorJson.error;
            else if (errorJson.message) errorMessage = errorJson.message;
        } catch (e) {
            errorMessage = errorText || errorMessage;
        }
        throw new Error(errorMessage);
      }

      const result = await response.json();

      if (result.success) {
        addMessage({ id: uuidv4(), role: 'bot', content: `Successfully published to Facebook Page! Post ID: ${result.postId}` });
      } else {
        throw new Error(result.error || 'Unknown error during Facebook publishing.');
      }
    } catch (error: any) {
      console.error('Publishing failed:', error);
      addMessage({ 
        id: uuidv4(), 
        role: 'bot', 
        content: `Failed to publish to Facebook Page.`,
        error: error.message || 'Unknown network error'
      });
    } finally {
      setIsPublishingToFacebook(false);
    }
  }, [addMessage]);

  const handleSendMessage = useCallback(async () => {
    if (isLoading || isPosting || isPublishingToFacebook) return; 

    if (currentFeature !== BotFeature.DAILY_POST && currentFeature !== BotFeature.SCHEDULE_POST && currentFeature !== BotFeature.CREATE_STORY && currentFeature !== BotFeature.DATA_MANAGEMENT && !input.trim()) return;

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
        } else if (messageToSchedule.audioUrl) {
          contentType = 'audio';
          originalContent = messageToSchedule.audioUrl;
          previewContent = `Audio: ${messageToSchedule.content.substring(0, 30)}...`;
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
      return;
    }

    if (currentFeature === BotFeature.DATA_MANAGEMENT) {
        return;
    }

    const userMessage: Message = { id: uuidv4(), role: 'user', content: input };
    if (currentFeature !== BotFeature.DAILY_POST && currentFeature !== BotFeature.CREATE_STORY) {
      addMessage(userMessage);
    }
    setInput('');
    setIsLoading(true);

    try {
      let generatedContentMessage: Message | undefined;

      switch (currentFeature) {
        case BotFeature.CHAT: {
          const { text, groundingUrls } = await generateTextContent(input, true);
          addMessage({ id: uuidv4(), role: 'bot', content: text, groundingUrls } as Message);
          break;
        }
        case BotFeature.EDIT_IMAGE: {
          if (!selectedImage) {
            addMessage({ id: uuidv4(), role: 'bot', content: 'Please upload an image to edit.', error: 'Please upload an image to edit.' });
            setIsLoading(false);
            return;
          }
          addMessage({ id: uuidv4(), role: 'bot', content: `Editing your image with: "${input}"...` });
          const editedImageUrl = await editImage(selectedImage, input);
          generatedContentMessage = { id: uuidv4(), role: 'bot', content: `Here is your edited image for "${input}":`, imageUrl: editedImageUrl };
          break;
        }
        case BotFeature.DAILY_POST: {
          if (dailyPostType === 'story_reel') {
             // --- Story/Reel Flow (Image + TTS) ---
             addMessage({ id: uuidv4(), role: 'bot', content: `Generating your ${dailyPostTheme} Reel/Story... (Creating text, voice, and visuals)` });

             // 1. Generate Text & Audio
             const prompt = `Generate a short ${dailyPostTheme} themed story or inspirational message suitable for a vertical social media reel/story. Keep it concise, around 100-150 words.`;
             const { text, groundingUrls, audioUrl } = await generateTextContent(
              prompt,
              false,
              true, // Force TTS on for Reels
              selectedDailyPostVoice
            );

            // 2. Generate Image based on the story text
            addMessage({ id: uuidv4(), role: 'bot', content: `...Writing complete. Now generating a vertical visual for your story...` });
            
            const imagePrompt = `A vertical 9:16 aspect ratio social media story background image. The theme is ${dailyPostTheme}. The scene description is: ${text.substring(0, 150)}. High quality, photorealistic or stylized art.`;
            const generatedImageUrl = await generateImageFromText(imagePrompt);

            generatedContentMessage = { 
              id: uuidv4(), 
              role: 'bot', 
              content: `Reel Generated (${dailyPostTheme}):\n\n${text}`, 
              groundingUrls, 
              audioUrl,
              imageUrl: generatedImageUrl 
            };

          } else {
            // --- Regular Post Flow (Text + Optional TTS) ---
            let prompt = `Generate a detailed ${dailyPostTheme} themed story or message suitable for a regular social media post. Make it engaging and provide a clear narrative or insightful reflection, around 200-300 words.`;
            addMessage({ id: uuidv4(), role: 'bot', content: `Generating your detailed Daily Post (${dailyPostTheme})...` });

            const { text, groundingUrls, audioUrl } = await generateTextContent(
              prompt,
              false,
              enableDailyPostTTS,
              selectedDailyPostVoice
            );
            generatedContentMessage = { id: uuidv4(), role: 'bot', content: `Daily Post (${dailyPostTheme}):\n\n${text}`, groundingUrls, audioUrl };
          }
          break;
        }
        case BotFeature.CREATE_STORY: {
          // Logic updated to always include Image and TTS
          let storyLengthInstruction = "Keep the story engaging and detailed, around 200-300 words for a voice narration.";

          let storyPrompt = `Generate a creative and engaging story with a ${storyTheme} theme. ${storyLengthInstruction}`;
          if (input.trim()) {
            storyPrompt += ` Incorporate the following idea: "${input.trim()}".`;
          }
          if (enableSongSuggestion) {
            storyPrompt += ` Also, suggest one song title and artist that would fit the mood of this story. Format the song suggestion clearly as: "Song Suggestion: [Song Title] by [Artist Name]".`;
          }
          addMessage({ id: uuidv4(), role: 'bot', content: `Creating a ${storyTheme} story for you (Text, Audio, & Visual)...` });

          // 1. Generate Text & Audio (Always Force TTS to true)
          const { text, groundingUrls, audioUrl } = await generateTextContent(
            storyPrompt,
            false,
            true, // Always generate Audio
            selectedStoryVoice
          );

          // 2. Generate Image
          addMessage({ id: uuidv4(), role: 'bot', content: `...Story generated. Creating a matching vertical image...` });
          
          let storyText = text || 'Could not generate story.';
          let songSuggestion = '';
          const songRegex = /Song Suggestion: (.+)/i;
          const match = storyText.match(songRegex);
          if (match && match[1]) {
            songSuggestion = match[1];
            storyText = storyText.replace(songRegex, '').trim();
          }

          const imagePrompt = `A vertical 9:16 aspect ratio social media story background image. Theme: ${storyTheme}. Context: ${storyText.substring(0, 100)}. High quality, moody, atmospheric art.`;
          const generatedImageUrl = await generateImageFromText(imagePrompt);

          let finalContent = `Story (${storyTheme}):\n\n${storyText}`;
          if (songSuggestion) {
            finalContent += `\n\n🎵 ${songSuggestion} (For inspiration, not playable audio)`;
          }

          generatedContentMessage = { 
            id: uuidv4(), 
            role: 'bot', 
            content: finalContent, 
            groundingUrls, 
            audioUrl,
            imageUrl: generatedImageUrl // Include the generated image
          };
          break;
        }
      }

      if (generatedContentMessage) {
        setIsLoading(false);
        setIsPosting(true);

        addMessage({ id: uuidv4(), role: 'bot', content: "Simulating 'Post Now' for your content..." });
        await new Promise(resolve => setTimeout(resolve, 2000));

        addMessage({ id: uuidv4(), role: 'bot', content: "Simulated 'Post Now' successful! Here's your content, ready for you to share manually on social media:" });
        addMessage(generatedContentMessage);
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
      setIsPosting(false);
      if (currentFeature === BotFeature.EDIT_IMAGE) {
        setSelectedImage(null);
      }
      if (currentFeature === BotFeature.DAILY_POST || currentFeature === BotFeature.CREATE_STORY) {
        setInput('');
      }
    }
  }, [input, isLoading, isPosting, currentFeature, selectedImage, dailyPostTheme, dailyPostType, enableDailyPostTTS, selectedDailyPostVoice, storyTheme, selectedStoryVoice, enableSongSuggestion, selectedMessageToSchedule, scheduledDateTime, messages, addMessage, isPublishingToFacebook]);

  const handleClearImage = useCallback(() => {
    setSelectedImage(null);
  }, []);

  const getBotMessagesForScheduling = useCallback(() => {
    return messages.filter(msg =>
      msg.role === 'bot' &&
      !msg.error &&
      (msg.content.trim() !== '...thinking...' || msg.imageUrl || msg.videoUrl || msg.audioUrl)
    );
  }, [messages]);

  const renderFeatureInput = () => {
    switch (currentFeature) {
      case BotFeature.EDIT_IMAGE:
        return (
          <div className="flex flex-col gap-2 p-2 bg-gray-50 rounded-md">
            <ImageUpload onImageSelected={setSelectedImage} isLoading={isLoading || isPosting || isPublishingToFacebook} clearImage={handleClearImage} />
            {selectedImage && (
              <>
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
                  placeholder="How do you want to edit the image? (e.g., 'Add a retro filter')"
                  className="p-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                  disabled={isLoading || isPosting || isPublishingToFacebook}
                />
                <button
                  onClick={handleSendMessage}
                  className="bg-blue-600 text-white p-2 rounded-md hover:bg-blue-700 transition-colors duration-200 disabled:opacity-50"
                  disabled={isLoading || isPosting || isPublishingToFacebook || !selectedImage}
                >
                  {isLoading ? 'Generating...' : isPosting ? 'Simulating Post...' : 'Edit & Post Image'}
                </button>
              </>
            )}
          </div>
        );
      case BotFeature.DAILY_POST:
        return (
          <div className="flex flex-col gap-2 p-2 bg-gray-50 rounded-md">
            <ThemeSelector selectedTheme={dailyPostTheme} onThemeChange={setDailyPostTheme} isLoading={isLoading || isPosting || isPublishingToFacebook} />
            <div className="flex items-center gap-2" role="radiogroup" aria-labelledby="post-type-label">
              <label id="post-type-label" className="text-gray-700 font-medium">Post Type:</label>
              {DAILY_POST_TYPES.map((type) => (
                <div key={type.value} className="flex items-center">
                  <input
                    type="radio"
                    id={`post-type-${type.value}`}
                    name="daily-post-type"
                    value={type.value}
                    checked={dailyPostType === type.value}
                    onChange={() => setDailyPostType(type.value as DailyPostType)}
                    disabled={isLoading || isPosting || isPublishingToFacebook}
                    className="mr-1"
                    aria-checked={dailyPostType === type.value}
                  />
                  <label htmlFor={`post-type-${type.value}`} className="text-sm">{type.label}</label>
                </div>
              ))}
            </div>

            <div className="flex flex-col gap-2 mt-2">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="enable-tts"
                  checked={enableDailyPostTTS}
                  onChange={(e) => setEnableDailyPostTTS(e.target.checked)}
                  disabled={isLoading || isPosting || isPublishingToFacebook || dailyPostType === 'story_reel'} 
                  className="mr-1"
                />
                <label htmlFor="enable-tts" className="text-gray-700 font-medium">
                   {dailyPostType === 'story_reel' ? 'Enable Text-to-Speech (Always On for Reels)' : 'Enable Text-to-Speech'}
                </label>
              </div>
              {(enableDailyPostTTS || dailyPostType === 'story_reel') && (
                <div className="flex items-center gap-2 pl-4">
                  <label htmlFor="voice-select" className="text-gray-700 text-sm">Voice:</label>
                  <select
                    id="voice-select"
                    value={selectedDailyPostVoice}
                    onChange={(e) => setSelectedDailyPostVoice(e.target.value as PrebuiltVoice)}
                    disabled={isLoading || isPosting || isPublishingToFacebook}
                    className="p-1 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                  >
                    {TTS_VOICES.map((voice) => (
                      <option key={voice.value} value={voice.value}>
                        {voice.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <p className="text-sm text-gray-600">
              Click below to generate a new post based on the selected theme, type, and optional voice.
            </p>
            <button
              onClick={handleSendMessage}
              className="bg-blue-600 text-white p-2 rounded-md hover:bg-blue-700 transition-colors duration-200 disabled:opacity-50"
              disabled={isLoading || isPosting || isPublishingToFacebook}
              aria-label={isLoading ? 'Generating Post...' : isPosting ? 'Simulating Post...' : 'Generate & Post Daily Content'}
            >
              {isLoading ? 'Generating Post...' : isPosting ? 'Simulating Post...' : 'Generate & Post Daily Content'}
            </button>
            <p className="text-xs text-gray-500 italic mt-2">
              Note: 'Posting' is a simulation within this app. Your content is generated here for you to manually share on social media.
            </p>
          </div>
        );
      case BotFeature.CREATE_STORY:
        return (
          <div className="flex flex-col gap-2 p-2 bg-gray-50 rounded-md">
            <ThemeSelector selectedTheme={storyTheme} onThemeChange={setStoryTheme} isLoading={isLoading || isPosting || isPublishingToFacebook} />

            <div className="flex flex-col gap-2 mt-2">
                <div className="flex items-center gap-2">
                  <label htmlFor="story-voice-select" className="text-gray-700 font-medium text-sm">Voice (TTS):</label>
                  <select
                    id="story-voice-select"
                    value={selectedStoryVoice}
                    onChange={(e) => setSelectedStoryVoice(e.target.value as PrebuiltVoice)}
                    disabled={isLoading || isPosting || isPublishingToFacebook}
                    className="p-1 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                  >
                    {TTS_VOICES.map((voice) => (
                      <option key={voice.value} value={voice.value}>
                        {voice.label}
                      </option>
                    ))}
                  </select>
                </div>
            </div>

            <div className="flex items-center gap-2 mt-2">
              <input
                type="checkbox"
                id="enable-song-suggestion"
                checked={enableSongSuggestion}
                onChange={(e) => setEnableSongSuggestion(e.target.checked)}
                disabled={isLoading || isPosting || isPublishingToFacebook}
                className="mr-1"
              />
              <label htmlFor="enable-song-suggestion" className="text-gray-700 font-medium">Suggest a Song</label>
            </div>

            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
              placeholder="Optional: Add a specific idea for your story..."
              className="p-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 mt-2"
              disabled={isLoading || isPosting || isPublishingToFacebook}
              aria-label="Story idea input"
            />

            <p className="text-sm text-gray-600">
              Click below to generate a new story (Image + Audio + Text) based on the selected theme.
            </p>
            <button
              onClick={handleSendMessage}
              className="bg-blue-600 text-white p-2 rounded-md hover:bg-blue-700 transition-colors duration-200 disabled:opacity-50"
              disabled={isLoading || isPosting || isPublishingToFacebook}
              aria-label={isLoading ? 'Generating Story...' : isPosting ? 'Simulating Post...' : 'Create & Post Story'}
            >
              {isLoading ? 'Generating Story...' : isPosting ? 'Simulating Post...' : 'Create & Post Story'}
            </button>
            <p className="text-xs text-gray-500 italic mt-2">
              Note: 'Posting' is a simulation within this app. Your content is generated here for you to manually share on social media.
            </p>
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
                    disabled={isLoading || isPosting || isPublishingToFacebook}
                    className="p-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                    aria-label="Select a bot message to schedule"
                  >
                    <option value="">-- Select a message --</option>
                    {botResponses.map((msg) => (
                      <option key={msg.id} value={msg.id}>
                        {msg.imageUrl ? 'Image: ' : msg.videoUrl ? 'Video: ' : msg.audioUrl ? 'Audio: ' : ''}
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
                    disabled={isLoading || isPosting || isPublishingToFacebook}
                    className="p-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                    aria-label="Select date and time for scheduling"
                  />
                </div>
                <button
                  onClick={handleSendMessage}
                  className="bg-blue-600 text-white p-2 rounded-md hover:bg-blue-700 transition-colors duration-200 disabled:opacity-50"
                  disabled={isLoading || isPosting || isPublishingToFacebook || !selectedMessageToSchedule || !scheduledDateTime}
                  aria-label={isLoading ? 'Scheduling post...' : 'Schedule Post'}
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
                        {post.contentType === 'audio' && '🔊 '}
                        {post.previewContent}
                      </p>
                      {(post.contentType === 'image' || post.contentType === 'video' || post.contentType === 'audio') && post.originalContent && (
                        <div className="mt-1 flex items-center gap-2">
                          {post.contentType === 'image' && <img src={post.originalContent} alt="Scheduled content preview" className="max-h-20 rounded-md object-contain" />}
                          {post.contentType === 'video' && <video src={post.originalContent} controls className="max-h-20 rounded-md object-contain" />}
                          {post.contentType === 'audio' && <audio src={post.originalContent} controls className="max-h-20 w-auto"></audio>}
                          <a href={post.originalContent} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline text-xs" aria-label={`View original ${post.contentType}`}>View original</a>
                        </div>
                      )}
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
              placeholder="Type your message here... (e.g., 'Write a story about a space cat')"
              className="flex-grow p-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
              disabled={isLoading || isPosting || isPublishingToFacebook}
              aria-label="Message input"
            />
            <button
              onClick={handleSendMessage}
              className="bg-blue-600 text-white p-2 rounded-md hover:bg-blue-700 transition-colors duration-200 disabled:opacity-50"
              disabled={isLoading || isPosting || isPublishingToFacebook}
              aria-label={isLoading ? 'Sending message...' : 'Send message'}
            >
              {isLoading ? 'Sending...' : 'Send'}
            </button>
          </div>
        );
    }
  };

  const currentStatusMessage = isLoading
    ? '...generating content...'
    : isPosting
      ? '...simulating post now...'
      : isPublishingToFacebook
        ? '...publishing to Facebook...' 
        : null;

  return (
    <div className="flex flex-col w-full max-w-2xl h-[90vh] bg-white rounded-lg shadow-xl overflow-hidden">
      <div className="bg-gradient-to-r from-blue-600 to-indigo-700 text-white p-4 text-center text-xl font-bold">
        Gemini Reels & Stories Bot
      </div>

      <div className="flex flex-wrap gap-2 p-3 bg-gray-50 border-b border-gray-200 justify-center">
        {BOT_FEATURES.map((feature) => (
          <button
            key={feature.id}
            onClick={() => {
              setCurrentFeature(feature.id);
              setInput(''); 
              setSelectedImage(null); 
              setSelectedMessageToSchedule(''); 
              setScheduledDateTime(''); 
            }}
            className={`flex items-center gap-1 px-3 py-1 rounded-full text-sm font-medium transition-colors duration-200
              ${currentFeature === feature.id
                ? 'bg-blue-600 text-white shadow-md'
                : 'bg-gray-200 text-gray-800 hover:bg-gray-300'}
              disabled:opacity-50 disabled:cursor-not-allowed`}
            title={feature.description}
            aria-label={feature.name}
            role="button"
          >
            {feature.icon} {feature.name}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-100">
        {messages.map((msg) => (
          <MessageBubble
            key={msg.id}
            message={msg}
            onPublishToFacebook={handlePublishToFacebook} 
            isPublishingDisabled={isLoading || isPosting || isPublishingToFacebook} 
          />
        ))}
        {currentStatusMessage && (
          <div className="flex justify-start" aria-live="polite" aria-atomic="true">
            <div className="bg-gray-300 text-gray-800 p-3 my-2 rounded-xl rounded-bl-none shadow-md">
              <span className="animate-pulse">{currentStatusMessage}</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="sticky bottom-0 p-4 bg-white border-t border-gray-200 shadow-lg">
        {renderFeatureInput()}
      </div>

      <div className="p-2 bg-gray-100 text-center text-xs text-gray-500 border-t border-gray-200 flex justify-center space-x-4">
        <a
          href="/?show=privacy"
          className="text-blue-600 hover:underline"
          aria-label="Open Privacy Policy"
        >
          Privacy Policy
        </a>
        <a
          href="/?show=terms"
          className="text-blue-600 hover:underline"
          aria-label="Open Terms of Service"
        >
          Terms of Service
        </a>
      </div>

      {showPrivacyPolicy && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-75 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="privacy-policy-title"
        >
          <PrivacyPolicy onClose={() => setShowPrivacyPolicy(false)} />
        </div>
      )}

      {showTermsOfService && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-75 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="terms-of-service-title"
        >
          <TermsOfService onClose={() => setShowTermsOfService(false)} />
        </div>
      )}
    </div>
  );
};

export default App;