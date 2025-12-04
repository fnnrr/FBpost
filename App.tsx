import React, { useState, useRef, useEffect, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import MessageBubble from './components/MessageBubble';
import ImageUpload from './components/ImageUpload';
import ThemeSelector from './components/ThemeSelector';
import PrivacyPolicy from './components/PrivacyPolicy';
import TermsOfService from './components/TermsOfService';
import {
  generateTextContent,
  // generateImage, // Removed for free API only
  editImage,
  // generateVideo, // Removed for free API only
} from './services/geminiService';
import { Message, BotFeature, /* ImageSize, VideoAspectRatio, */ DailyPostTheme, DailyPostType, ScheduledPost, PrebuiltVoice } from './types';
import { BOT_FEATURES, DAILY_POST_THEMES, DAILY_POST_TYPES, TTS_VOICES } from './constants';

const App: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false); // Indicates content generation is happening
  const [isPosting, setIsPosting] = useState<boolean>(false); // Indicates "post now" simulation is happening
  const [isPublishingToFacebook, setIsPublishingToFacebook] = useState<boolean>(false); // New state for Facebook publishing
  const [currentFeature, setCurrentFeature] = useState<BotFeature>(BotFeature.CHAT);
  const [showPrivacyPolicy, setShowPrivacyPolicy] = useState<boolean>(false);
  const [showTermsOfService, setShowTermsOfService] = useState<boolean>(false);

  // States for specific features
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  // const [imageSize, setImageSize] = useState<ImageSize>('1K'); // Removed for free API only
  // const [videoAspectRatio, setVideoAspectRatio] = useState<VideoAspectRatio>('16:9'); // Removed for free API only
  const [dailyPostTheme, setDailyPostTheme] = useState<DailyPostTheme>('inspirational');
  const [dailyPostType, setDailyPostType] = useState<DailyPostType>('story_reel'); // New state for daily post type
  const [enableDailyPostTTS, setEnableDailyPostTTS] = useState<boolean>(false); // New state for TTS
  const [selectedDailyPostVoice, setSelectedDailyPostVoice] = useState<PrebuiltVoice>(PrebuiltVoice.ZEPHYR); // New state for TTS voice

  // States for Create Story feature
  const [storyTheme, setStoryTheme] = useState<DailyPostTheme>('inspirational');
  const [enableStoryTTS, setEnableStoryTTS] = useState<boolean>(false);
  const [selectedStoryVoice, setSelectedStoryVoice] = useState<PrebuiltVoice>(PrebuiltVoice.ZEPHYR);
  const [enableSongSuggestion, setEnableSongSuggestion] = useState<boolean>(false);


  // States for Schedule Post feature
  const [scheduledPosts, setScheduledPosts] = useState<ScheduledPost[]>([]); // Corrected this line
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

  // Handle URL parameters for displaying modals on initial load
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const path = window.location.pathname;

    // Check both query parameters and clean paths
    if (params.get('show') === 'privacy' || path === '/privacy-policy') {
      setShowPrivacyPolicy(true);
    } else if (params.get('show') === 'terms' || path === '/terms-of-service') {
      setShowTermsOfService(true);
    }

    // Optionally clear the URL parameter if it was set by an internal link click
    // This helps keep the URL clean after the modal is shown, but retains clean paths.
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
        setScheduledPosts([]); // Clear state immediately
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
        // Facebook Graph API expects base64 or a public URL. Our imageUrl is already a data URI (base64).
        payload.imageUrl = message.imageUrl;
      }
      // Note: VideoUrl not supported yet for direct upload from data URI in this implementation.
      // If message.videoUrl were a public URL, it could be added to payload.

      const response = await fetch('/netlify/functions/publishToFacebookPage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const result = await response.json();

      if (response.ok && result.success) {
        addMessage({ id: uuidv4(), role: 'bot', content: `Successfully published to Facebook Page! Post ID: ${result.postId}` });
      } else {
        throw new Error(result.error || 'Unknown error during Facebook publishing.');
      }
    } catch (error: any) {
      console.error('Error publishing to Facebook:', error);
      addMessage({ id: uuidv4(), role: 'bot', content: `Failed to publish to Facebook Page.`, error: error.message || 'Please check your environment variables (FB_PAGE_ID, FB_PAGE_ACCESS_TOKEN) and app permissions.' });
    } finally {
      setIsPublishingToFacebook(false);
    }
  }, [addMessage]);


  const handleSendMessage = useCallback(async () => {
    if (isLoading || isPosting || isPublishingToFacebook) return; // Prevent multiple requests or interactions during loading/posting/publishing

    if (currentFeature !== BotFeature.DAILY_POST && currentFeature !== BotFeature.SCHEDULE_POST && currentFeature !== BotFeature.CREATE_STORY && currentFeature !== BotFeature.DATA_MANAGEMENT && !input.trim()) return;

    // Handle scheduling separately, as it doesn't involve sending input to Gemini
    if (currentFeature === BotFeature.SCHEDULE_POST) {
      if (!selectedMessageToSchedule || !scheduledDateTime) {
        alert('Please select a message and a scheduled date/time.');
        return;
      }
      setIsLoading(true); // Use isLoading for the scheduling operation itself
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
        setIsLoading(false); // Ensure loading is off for scheduling
      }
      return; // Exit here as scheduling is handled
    }

    if (currentFeature === BotFeature.DATA_MANAGEMENT) {
        // Data Management actions are handled by specific buttons, not the generic send button.
        // This case should ideally not be reached if buttons are disabled correctly.
        return;
    }


    const userMessage: Message = { id: uuidv4(), role: 'user', content: input };
    if (currentFeature !== BotFeature.DAILY_POST && currentFeature !== BotFeature.CREATE_STORY) {
      addMessage(userMessage); // Only add user message if it's not generated by button click
    }
    setInput('');
    setIsLoading(true); // Start loading for content generation

    try {
      let generatedContentMessage: Message | undefined;

      switch (currentFeature) {
        case BotFeature.CHAT: {
          const { text, groundingUrls } = await generateTextContent(input, true); // Enable Google Search for general chat
          addMessage({ id: uuidv4(), role: 'bot', content: text, groundingUrls } as Message);
          break;
        }
        case BotFeature.EDIT_IMAGE: {
          if (!selectedImage) {
            addMessage({ id: uuidv4(), role: 'bot', content: 'Please upload an image to edit.', error: 'Please upload an image to edit.' });
            setIsLoading(false); // End loading if validation fails
            return;
          }
          addMessage({ id: uuidv4(), role: 'bot', content: `Editing your image with: "${input}"...` }); // Immediate feedback
          const editedImageUrl = await editImage(selectedImage, input);
          generatedContentMessage = { id: uuidv4(), role: 'bot', content: `Here is your edited image for "${input}":`, imageUrl: editedImageUrl };
          break;
        }
        case BotFeature.DAILY_POST: {
          let prompt = '';
          let initialBotMessage = `Generating your `;
          if (dailyPostType === 'story_reel') {
            prompt = `Generate a short ${dailyPostTheme} themed story or inspirational message suitable for a social media reel/story. Keep it concise, around 100-150 words.`;
            initialBotMessage += `short & engaging `;
          } else { // regular_post
            prompt = `Generate a detailed ${dailyPostTheme} themed story or message suitable for a regular social media post. Make it engaging and provide a clear narrative or insightful reflection, around 200-300 words.`;
            initialBotMessage += `detailed `;
          }
          initialBotMessage += `Daily Post (${dailyPostTheme} - ${dailyPostType.replace('_', ' ')})`;
          if (enableDailyPostTTS) {
            initialBotMessage += ` (with voice)`;
          }
          initialBotMessage += `...`;

          addMessage({ id: uuidv4(), role: 'bot', content: initialBotMessage }); // Immediate feedback

          const { text, groundingUrls, audioUrl } = await generateTextContent(
            prompt,
            false, // No Google Search for daily posts
            enableDailyPostTTS,
            selectedDailyPostVoice
          );
          generatedContentMessage = { id: uuidv4(), role: 'bot', content: `Daily Post (${dailyPostTheme} - ${dailyPostType.replace('_', ' ')}):\n\n${text}`, groundingUrls, audioUrl };
          break;
        }
        case BotFeature.CREATE_STORY: {
          let storyLengthInstruction = '';
          if (enableStoryTTS) {
            storyLengthInstruction = "Keep the story engaging and detailed, around 200-300 words for a voice narration.";
          } else {
            storyLengthInstruction = "Keep the story concise, vivid, and rich, around 50-100 words.";
          }

          let storyPrompt = `Generate a creative and engaging story with a ${storyTheme} theme. ${storyLengthInstruction}`;
          if (input.trim()) {
            storyPrompt += ` Incorporate the following idea: "${input.trim()}".`;
          }
          if (enableSongSuggestion) {
            storyPrompt += ` Also, suggest one song title and artist that would fit the mood of this story. Format the song suggestion clearly as: "Song Suggestion: [Song Title] by [Artist Name]".`;
          }
          addMessage({ id: uuidv4(), role: 'bot', content: `Creating a ${storyTheme} story for you ${enableStoryTTS ? '(with voice and a longer narrative)' : '(concise and rich)'}...` });

          const { text, groundingUrls, audioUrl } = await generateTextContent(
            storyPrompt,
            false, // No Google Search for stories
            enableStoryTTS, // Pass enableStoryTTS to generateTextContent
            selectedStoryVoice
          );

          let storyText = text || 'Could not generate story.';
          let songSuggestion = '';
          const songRegex = /Song Suggestion: (.+)/i;
          const match = storyText.match(songRegex);
          if (match && match[1]) {
            songSuggestion = match[1];
            storyText = storyText.replace(songRegex, '').trim(); // Remove song suggestion from main story text
          }

          let finalContent = `Story (${storyTheme}):\n\n${storyText}`;
          if (songSuggestion) {
            finalContent += `\n\n🎵 ${songSuggestion} (For inspiration, not playable audio)`;
          }

          generatedContentMessage = { id: uuidv4(), role: 'bot', content: finalContent, groundingUrls, audioUrl };
          break;
        }
      }

      // If content was generated for Daily Post, Edit Image, or Create Story, simulate posting
      if (generatedContentMessage) {
        setIsLoading(false); // Generation is complete
        setIsPosting(true); // Start posting simulation

        addMessage({ id: uuidv4(), role: 'bot', content: "Simulating 'Post Now' for your content..." });
        await new Promise(resolve => setTimeout(resolve, 2000)); // Simulate network delay

        addMessage({ id: uuidv4(), role: 'bot', content: "Simulated 'Post Now' successful! Here's your content, ready for you to share manually on social media:" });
        addMessage(generatedContentMessage); // Add the actual generated content
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
      setIsLoading(false); // Ensure loading is off
      setIsPosting(false); // Ensure posting simulation is off
      // For image/video features, reset selected image after successful operation or error
      if (currentFeature === BotFeature.EDIT_IMAGE /* || currentFeature === BotFeature.ANIMATE_IMAGE */) {
        setSelectedImage(null);
      }
      // Reset input for Daily Post and Create Story as well, since they use a button
      if (currentFeature === BotFeature.DAILY_POST || currentFeature === BotFeature.CREATE_STORY) {
        setInput('');
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, isLoading, isPosting, currentFeature, selectedImage, /* imageSize, videoAspectRatio, */ dailyPostTheme, dailyPostType, enableDailyPostTTS, selectedDailyPostVoice, storyTheme, enableStoryTTS, selectedStoryVoice, enableSongSuggestion, selectedMessageToSchedule, scheduledDateTime, messages, addMessage, isPublishingToFacebook]); // Added isPublishingToFacebook here

  const handleClearImage = useCallback(() => {
    setSelectedImage(null);
  }, []);

  const getBotMessagesForScheduling = useCallback(() => {
    // Filter for bot messages that are not errors and have actual content/image/video/audio
    return messages.filter(msg =>
      msg.role === 'bot' &&
      !msg.error &&
      (msg.content.trim() !== '...thinking...' || msg.imageUrl || msg.videoUrl || msg.audioUrl)
    );
  }, [messages]);

  const renderFeatureInput = () => {
    switch (currentFeature) {
      // case BotFeature.GENERATE_IMAGE: // Removed for free API only
      //   return (
      //     <div className="flex flex-col gap-2 p-2 bg-gray-50 rounded-md">
      //       <label className="text-sm font-medium text-gray-700">Image Size:</label>
      //       <div className="flex gap-2">
      //         {(['1K', '2K', '4K'] as ImageSize[]).map((size) => (
      //           <button
      //             key={size}
      //             onClick={() => setImageSize(size)}
      //             className={`px-3 py-1 rounded-md text-sm font-medium ${
      //               imageSize === size ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
      //             } disabled:opacity-50`}
      //             disabled={isLoading}
      //           >
      //             {size}
      //           </button>
      //         ))}
      //       </div>
      //       <input
      //         type="text"
      //         value={input}
      //         onChange={(e) => setInput(e.target.value)}
      //         onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
      //         placeholder="Describe the image you want to create (e.g., 'A robot riding a skateboard')"
      //         className="p-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
      //         disabled={isLoading}
      //       />
      //       <button
      //         onClick={handleSendMessage}
      //         className="bg-blue-600 text-white p-2 rounded-md hover:bg-blue-700 transition-colors duration-200 disabled:opacity-50"
      //         disabled={isLoading}
      //       >
      //         {isLoading ? 'Generating...' : 'Generate Image'}
      //       </button>
      //     </div>
      //   );
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
      // case BotFeature.ANIMATE_IMAGE: // Removed for free API only
      //   return (
      //     <div className="flex flex-col gap-2 p-2 bg-gray-50 rounded-md">
      //       <ImageUpload onImageSelected={setSelectedImage} isLoading={isLoading} clearImage={handleClearImage} />
      //       <label className="text-sm font-medium text-gray-700">Aspect Ratio:</label>
      //       <div className="flex gap-2">
      //         {(['16:9', '9:16'] as VideoAspectRatio[]).map((ratio) => (
      //           <button
      //             key={ratio}
      //             onClick={() => setVideoAspectRatio(ratio)}
      //             className={`px-3 py-1 rounded-md text-sm font-medium ${
      //               videoAspectRatio === ratio ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
      //             } disabled:opacity-50`}
      //             disabled={isLoading}
      //           >
      //             {ratio}
      //           </button>
      //         ))}
      //       </div>
      //       <input
      //         type="text"
      //         value={input}
      //         onChange={(e) => setInput(e.target.value)}
      //         onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
      //         placeholder="Optional: Describe the animation (e.g., 'A cat driving fast')"
      //         className="p-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
      //         disabled={isLoading}
      //       />
      //       <button
      //         onClick={handleSendMessage}
      //         className="bg-blue-600 text-white p-2 rounded-md hover:bg-blue-700 transition-colors duration-200 disabled:opacity-50"
      //         disabled={isLoading}
      //       >
      //         {isLoading ? 'Animating...' : 'Animate Image'}
      //       </button>
      //     </div>
      //   );
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

            {/* New: Text-to-Speech Options */}
            <div className="flex flex-col gap-2 mt-2">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="enable-tts"
                  checked={enableDailyPostTTS}
                  onChange={(e) => setEnableDailyPostTTS(e.target.checked)}
                  disabled={isLoading || isPosting || isPublishingToFacebook}
                  className="mr-1"
                />
                <label htmlFor="enable-tts" className="text-gray-700 font-medium">Enable Text-to-Speech</label>
              </div>
              {enableDailyPostTTS && (
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

            {/* Text-to-Speech Options for Story */}
            <div className="flex flex-col gap-2 mt-2">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="enable-story-tts"
                  checked={enableStoryTTS}
                  onChange={(e) => setEnableStoryTTS(e.target.checked)}
                  disabled={isLoading || isPosting || isPublishingToFacebook}
                  className="mr-1"
                />
                <label htmlFor="enable-story-tts" className="text-gray-700 font-medium">Enable Text-to-Speech</label>
              </div>
              {enableStoryTTS && (
                <div className="flex items-center gap-2 pl-4">
                  <label htmlFor="story-voice-select" className="text-gray-700 text-sm">Voice:</label>
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
              )}
            </div>

            {/* Song Suggestion Option */}
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
              Click below to generate a new story based on the selected theme, optional voice, and song suggestion.
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
                      {/* Optionally, display full content/link if it's an image/video/audio for better preview */}
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
      case BotFeature.DATA_MANAGEMENT:
        return (
          <div className="flex flex-col gap-4 p-4 bg-gray-50 rounded-md">
            <h3 className="text-lg font-semibold text-gray-800">Manage Your Data</h3>

            <div className="flex flex-col gap-2">
              <p className="text-base font-medium text-gray-700">Local Data (Scheduled Posts):</p>
              <p className="text-sm text-gray-600">
                The "Schedule Post" feature stores your scheduled content previews directly in your browser's local storage. This data is not sent to our servers.
              </p>
              <button
                onClick={handleClearLocalScheduledPosts}
                className="bg-red-600 text-white p-2 rounded-md hover:bg-red-700 transition-colors duration-200 disabled:opacity-50"
                disabled={isLoading || isPosting || isPublishingToFacebook}
                aria-label="Clear all local scheduled posts"
              >
                Clear Local Scheduled Posts
              </button>
            </div>

            <div className="flex flex-col gap-2 mt-4">
              <p className="text-base font-medium text-gray-700">Facebook Messenger Data:</p>
              <p className="text-sm text-gray-600">
                When you interact with the bot via Facebook Messenger, your messages and associated IDs are stored on our server (MongoDB) to enable bot functionality.
                To request deletion of this data, please refer to our <a href="/privacy-policy" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline font-medium">Privacy Policy</a> (Section "Your Rights") for detailed instructions on how to initiate a data deletion request through Facebook.
              </p>
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
        ? '...publishing to Facebook...' // New status message
        : null;

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
            title={feature.description}
            aria-label={feature.name}
            role="button"
          >
            {feature.icon} {feature.name}
          </button>
        ))}
      </div>

      {/* Chat Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-100">
        {messages.map((msg) => (
          <MessageBubble
            key={msg.id}
            message={msg}
            onPublishToFacebook={handlePublishToFacebook} // Pass the new handler
            isPublishingDisabled={isLoading || isPosting || isPublishingToFacebook} // Disable button when any main process is active
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

      {/* Input Area (sticky footer) */}
      <div className="sticky bottom-0 p-4 bg-white border-t border-gray-200 shadow-lg">
        {renderFeatureInput()}
      </div>

      {/* Footer for Privacy Policy and Terms of Service */}
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

      {/* Privacy Policy Modal */}
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

      {/* Terms of Service Modal */}
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