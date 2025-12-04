import { Buffer } from 'buffer';
import { Handler, Context, HandlerContext } from '@netlify/functions';
import { MongoClient, Db } from 'mongodb'; // Import MongoClient and Db types
import { GoogleGenAI, Modality } from '@google/genai'; // Added Modality
import { GEMINI_FLASH_MODEL, GEMINI_FLASH_IMAGE_MODEL, GEMINI_FLASH_TTS_MODEL } from '../../constants'; // Use constants for model names
import { DailyPostTheme, DailyPostType, BotFeature, PrebuiltVoice } from '../../types'; // Import types for Daily Post and BotFeature, PrebuiltVoice

// Environment variables to be set in Netlify dashboard (Site settings -> Build & deploy -> Environment variables):
// MONGODB_URI: Your MongoDB connection string (e.g., from MongoDB Atlas)
// MONGODB_DB_NAME: The name of your database (e.g., 'messengerbotdb')
// FB_VERIFY_TOKEN: The token you set in your Facebook App's Messenger settings for webhook verification
// FB_PAGE_ACCESS_TOKEN: The Page Access Token generated for your Facebook Page
// API_KEY: Your Google Gemini API key (as per coding guidelines)

const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME || 'messengerbotdb'; // Default database name if not specified
const FB_VERIFY_TOKEN = process.env.FB_VERIFY_TOKEN;
const FB_PAGE_ACCESS_TOKEN = process.env.FB_PAGE_ACCESS_TOKEN;
const API_KEY = process.env.API_KEY; // Using API_KEY as per coding guidelines

// Cache database connection for better performance in serverless environments
let cachedDb: Db;

/**
 * Connects to MongoDB, caching the connection for subsequent calls.
 * Throws an error if MONGODB_URI is not set.
 */
async function connectToDatabase(): Promise<Db> {
  if (cachedDb) {
    console.log('Using cached MongoDB connection.');
    return cachedDb;
  }
  if (!MONGODB_URI) {
    throw new Error('MONGODB_URI is not set in environment variables.');
  }

  try {
    console.log('Attempting to establish new MongoDB connection...');
    const client = await MongoClient.connect(MONGODB_URI, {
      // Add connection options for better resilience and timeout handling
      connectTimeoutMS: 15000, // 15 seconds connection timeout
      serverSelectionTimeoutMS: 15000, // 15 seconds server selection timeout
    });
    const db = client.db(MONGODB_DB_NAME);
    cachedDb = db;
    console.log('Successfully connected to MongoDB.');
    return db;
  } catch (error) {
    console.error('Failed to connect to MongoDB:', error);
    throw new Error(`MongoDB connection failed: ${error}`);
  }
}

/**
 * Helper function to fetch an image from a URL and base64 encode it.
 * @param url The URL of the image.
 * @param mimeType The MIME type of the image (e.g., 'image/jpeg').
 * @returns Base64 encoded string of the image.
 */
async function fetchAndBase64Encode(url: string, mimeType: string): Promise<string> {
  console.log(`Fetching and base64 encoding image from URL: ${url}`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch image from URL: ${url} (Status: ${response.status})`);
  }
  const arrayBuffer = await response.arrayBuffer();
  // Buffer is globally available in Node.js environments like Netlify Functions
  const base64 = Buffer.from(arrayBuffer).toString('base64');
  console.log('Image successfully fetched and base64 encoded.');
  return base64;
}

/**
 * Netlify Function handler for Facebook Messenger webhooks.
 * Handles both GET (verification) and POST (incoming messages) requests.
 */
// Corrected the type of the `context` parameter to `HandlerContext`
const handler: Handler = async (event, context: HandlerContext) => {
  // Essential check for FB_VERIFY_TOKEN, required for both GET and POST requests
  if (!FB_VERIFY_TOKEN) {
    console.error('FB_VERIFY_TOKEN is missing in environment variables. Webhook cannot operate.');
    return {
      statusCode: 500,
      body: JSON.stringify({ message: 'FB_VERIFY_TOKEN is not configured.' }),
    };
  }

  // --- 1. Webhook Verification (GET request from Facebook) ---
  if (event.httpMethod === 'GET') {
    const query = event.queryStringParameters;
    const mode = query?.['hub.mode'];
    const token = query?.['hub.verify_token'];
    const challenge = query?.['hub.challenge'];

    if (mode === 'subscribe' && token === FB_VERIFY_TOKEN) {
      console.log('Webhook verified successfully!');
      return {
        statusCode: 200,
        body: challenge,
      };
    } else {
      console.error('Webhook verification failed: Invalid mode or token.');
      return { statusCode: 403, body: 'Forbidden' };
    }
  }

  // --- 2. Handle Incoming Messages (POST request from Facebook) ---
  if (event.httpMethod === 'POST') {
    console.log('Received POST request, parsing body...');
    // For POST requests, all other critical environment variables are needed.
    if (!API_KEY || !FB_PAGE_ACCESS_TOKEN || !MONGODB_URI) {
      console.error('Missing required environment variables for POST message handling.');
      return {
        statusCode: 500,
        body: JSON.stringify({ message: 'Missing required environment variables for POST message handling.' }),
      };
    }

    let body;
    try {
      body = JSON.parse(event.body || '{}');
      console.log('Parsed webhook body.');
    } catch (e) {
      console.error('Failed to parse incoming webhook body (invalid JSON):', e);
      return { statusCode: 400, body: 'Invalid JSON payload' };
    }

    if (body.object === 'page') {
      for (const entry of body.entry) {
        for (const messagingEvent of entry.messaging) {
          console.log('Processing messaging event:', JSON.stringify(messagingEvent));
          const senderId = messagingEvent.sender.id;
          const messageText = messagingEvent.message?.text;
          const messageAttachments = messagingEvent.message?.attachments; // Handle attachments (e.g., images)
          const timestamp = new Date();

          // Initialize Gemini API client (do this per-request in serverless to ensure latest API key if it changes)
          const ai = new GoogleGenAI({ apiKey: API_KEY });
          console.log('GoogleGenAI client initialized.');

          try {
            // Connect to MongoDB
            const db = await connectToDatabase();
            const incomingMessagesCollection = db.collection('incoming_messages'); // Example collection

            // Store the incoming message in MongoDB (example usage)
            console.log('Attempting to insert message into MongoDB...');
            await incomingMessagesCollection.insertOne({
              senderId,
              messageText,
              messageAttachments,
              timestamp,
              source: 'messenger-webhook',
              fullEvent: messagingEvent, // Store full event for debugging
            });
            console.log(`Stored message from ${senderId}: "${messageText || JSON.stringify(messageAttachments)}"`);

            // --- Core Bot Logic: Integrate Gemini and determine response ---
            let botResponseText = 'Oops! I received your message but could not process it.';
            let botImageUrl: string | undefined;
            let botAudioUrl: string | undefined; // Added for audio
            // let botVideoUrl: string | undefined; // Video generation is not currently enabled in frontend or backend
            let sendQuickReplies = false;

            if (messageText) {
                const lowerCaseText = messageText.toLowerCase();
                console.log(`User message text: "${messageText}"`);

                // --- NEW: Handle "Post Now" intent ---
                if (lowerCaseText.includes('post now') || lowerCaseText.includes('publish this') || lowerCaseText.includes('share this') || lowerCaseText.includes('upload this') || lowerCaseText.includes('make it live')) {
                  console.log('Detected "Post Now" intent.');
                  botResponseText = `I understand you want to post this directly! However, as a Messenger bot, I'm designed to help you *create* content, not publish it directly to social media platforms like Facebook or Instagram. This is due to platform security and API limitations.
                  \n\nI can generate text, images, or audio for you. Once I send it, you can easily copy and paste it into your desired social media app. If you're using the full web app in your browser, you can also manage generated content with its local 'Schedule Post' feature.
                  \n\nHow can I help you generate something creative today?`;
                  sendQuickReplies = true; // Always offer quick replies after this explanation
                } else if (lowerCaseText.includes('post') && (lowerCaseText.includes('story') || lowerCaseText.includes('reel') || lowerCaseText.includes('daily post') || lowerCaseText.includes('generate post'))) {
                  console.log('Detected Daily Post command.');
                  // This block handles various daily post requests like "Post sad story", "daily post funny", "generate a reel"
                  let theme: DailyPostTheme = 'inspirational'; // Default
                  let type: DailyPostType = 'story_reel'; // Default for social media stories/reels
                  let enableTTS: boolean = false;
                  let selectedVoice: PrebuiltVoice = PrebuiltVoice.ZEPHYR; // Default voice

                  // Try to extract theme
                  const themes: DailyPostTheme[] = ['inspirational', 'sad', 'storytelling', 'funny'];
                  for (const t of themes) {
                    if (lowerCaseText.includes(t)) {
                      theme = t;
                      break;
                    }
                  }

                  // Try to extract post type
                  if (lowerCaseText.includes('regular post') || lowerCaseText.includes('detailed post') || lowerCaseText.includes('long post')) {
                    type = 'regular_post';
                  } else if (lowerCaseText.includes('story') || lowerCaseText.includes('reel') || lowerCaseText.includes('short post') || lowerCaseText.includes('daily post')) {
                    type = 'story_reel';
                  }

                  // Check for TTS request
                  if (lowerCaseText.includes('with voice') || lowerCaseText.includes('read aloud')) {
                    enableTTS = true;
                    // Could also try to extract a specific voice here, but for simplicity, use default for Messenger
                    // In a more advanced bot, you might have:
                    // const voices: PrebuiltVoice[] = [PrebuiltVoice.KORE, PrebuiltVoice.PUCK, ...];
                    // for (const v of voices) { if (lowerCaseText.includes(v.toLowerCase())) { selectedVoice = v; break; } }
                  }


                  let prompt = '';
                  if (type === 'story_reel') {
                    prompt = `Generate a short ${theme} themed story or inspirational message suitable for a social media reel/story. Keep it concise, around 100-150 words.`;
                  } else { // regular_post
                    prompt = `Generate a detailed ${theme} themed story or message suitable for a regular social media post. Make it engaging and provide a clear narrative or insightful reflection, around 200-300 words.`;
                  }
                  console.log(`Generated Gemini prompt for Daily Post: "${prompt}" (TTS: ${enableTTS})`);

                  console.log('Calling Gemini API for text content...');
                  const textGenResponse = await ai.models.generateContent({
                    model: GEMINI_FLASH_MODEL,
                    contents: prompt,
                  });
                  textGenResponse.text; // Ensure text property is accessed

                  botResponseText = `Daily Post (${theme} - ${type.replace('_', ' ')}):\n\n${textGenResponse.text || 'Could not generate post.'}`;

                  if (enableTTS && textGenResponse.text) {
                    console.log(`Generating speech for text: "${textGenResponse.text.substring(0, 50)}..." with voice: ${selectedVoice}`);
                    try {
                      const ttsResponse = await ai.models.generateContent({
                        model: GEMINI_FLASH_TTS_MODEL,
                        contents: [{ parts: [{ text: textGenResponse.text }] }],
                        config: {
                          responseModalities: [Modality.AUDIO],
                          speechConfig: {
                            voiceConfig: { prebuiltVoiceConfig: { voiceName: selectedVoice } },
                          },
                        },
                      });

                      const base64Audio = ttsResponse.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
                      if (base64Audio) {
                        botAudioUrl = `data:audio/wav;base64,${base64Audio}`; // This will be a data URI for raw PCM
                        botResponseText += `\n\n(Note: Audio was generated with voice ${selectedVoice} but cannot be sent directly in Messenger. Please use the web app for the full experience.)`;
                      } else {
                        console.warn('No audio data received from TTS model for Messenger.');
                        botResponseText += `\n\n(Note: Could not generate audio for this post.)`;
                      }
                    } catch (ttsError: any) {
                      console.error('Error generating TTS for Messenger:', ttsError);
                      botResponseText += `\n\n(Note: Failed to generate audio: ${ttsError.message || 'Unknown error'})`;
                    }
                  }
                  sendQuickReplies = true; // Offer quick replies after a feature interaction

                } else if (lowerCaseText.startsWith('edit this image:') && messageAttachments?.length > 0) {
                  console.log('Detected Image Edit command.');
                  // Example: "edit this image: add a hat" (with an attached image)
                  const attachment = messageAttachments[0];
                  if (attachment.type === 'image' && attachment.payload.url) {
                    const editPrompt = messageText.substring('edit this image:'.length).trim();
                    if (!editPrompt) {
                        botResponseText = "Please tell me how you want to edit the image after 'edit this image:'.";
                    } else {
                        botResponseText = `Editing your image with prompt: "${editPrompt}"... This might take a moment.`;

                        try {
                            const base64ImageData = await fetchAndBase64Encode(attachment.payload.url, attachment.mimeType || 'image/jpeg');
                            console.log('Calling Gemini API for image editing...');
                            const response = await ai.models.generateContent({
                                model: GEMINI_FLASH_IMAGE_MODEL,
                                contents: {
                                    parts: [
                                        {
                                            inlineData: {
                                                data: base64ImageData,
                                                mimeType: attachment.mimeType || 'image/jpeg',
                                            },
                                        },
                                        {
                                            text: editPrompt,
                                        },
                                    ],
                                },
                            });
                            console.log('Gemini API returned image edit response.');

                            for (const part of response.candidates?.[0]?.content?.parts || []) {
                                if (part.inlineData?.data && part.inlineData.mimeType) {
                                    botImageUrl = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
                                    botResponseText = `Here is your edited image for "${editPrompt}":`;
                                    break;
                                }
                            }
                            if (!botImageUrl) {
                                botResponseText = 'No edited image part found in the Gemini response.';
                            }
                        } catch (imageEditError: any) {
                            console.error('Error during image editing:', imageEditError);
                            botResponseText = `Failed to edit image: ${imageEditError.message || 'Unknown error'}`;
                        }
                    }
                  } else {
                    botResponseText = "To edit an image, please send an image attachment with your 'edit this image:' command.";
                  }
                  sendQuickReplies = true; // Offer quick replies after a feature interaction

                } else if (lowerCaseText.includes('schedule post') || lowerCaseText.includes(BotFeature.SCHEDULE_POST.replace('_', ' '))) {
                  console.log('Detected Schedule Post command in Messenger.');
                  botResponseText = "The 'Schedule Post' feature is managed in the web application (your browser). You can generate content here, then use the web app to schedule it! Feel free to ask me to 'Post inspirational story' or 'Edit this image' with an attachment.";
                  sendQuickReplies = true;
                } else if (lowerCaseText === BotFeature.CHAT.replace('_', ' ')) {
                  // If user clicked 'Chat & Story' quick reply, just give a general prompt
                  botResponseText = "Okay, let's chat! What's on your mind or what kind of story would you like?";
                  sendQuickReplies = true;
                } else if (lowerCaseText === BotFeature.DAILY_POST.replace('_', ' ')) {
                  botResponseText = "What kind of daily post would you like? Try 'Post funny story' or 'Generate a sad regular post with voice'.";
                  sendQuickReplies = true;
                } else if (lowerCaseText === BotFeature.EDIT_IMAGE.replace('_', ' ')) {
                  botResponseText = "Please send me an image with your editing request, for example: 'Edit this image: add a hat'.";
                  sendQuickReplies = true;
                }
                else {
                  console.log('Detected general chat message, calling Gemini API...');
                  // Default chat response using Gemini.
                  const geminiResponse = await ai.models.generateContent({
                      model: GEMINI_FLASH_MODEL,
                      contents: `The user said: "${messageText}". Respond in the style of a helpful social media assistant, suggesting creative post or story ideas, or offering to help with image/video generation based on their query. Keep your response concise.`,
                  });
                  console.log('Gemini API returned general chat response.');
                  botResponseText = (geminiResponse.text || 'How can I assist you?');
                  sendQuickReplies = true; // Always send quick replies for general chat
                }
            } else if (messageAttachments && messageAttachments.length > 0) {
              console.log('Received attachment without specific text command.');
              // Generic handling for attachments without a specific command
              botResponseText = "I received an attachment! To edit an image, please use the format 'Edit this image: [your prompt]' and attach the image. Or choose an option below:";
              sendQuickReplies = true; // Offer quick replies
            } else {
              // No message text or attachments, likely a greeting or initial contact
              botResponseText = "Hello! I'm your Gemini-powered social media assistant. How can I help you today?";
              sendQuickReplies = true; // Always send quick replies for initial contact
            }

            // --- Send Response back to Messenger ---
            console.log('Attempting to send Messenger reply...');
            await sendMessengerMessage(senderId, botResponseText, FB_PAGE_ACCESS_TOKEN, botImageUrl, undefined, botAudioUrl, sendQuickReplies); // Pass sendQuickReplies and botAudioUrl here
            console.log('Messenger reply sent.');

          } catch (error: any) {
            console.error(`Error processing Messenger event for ${senderId} or interacting with DB/Gemini:`, error);
            // Attempt to send an error message back to the user
            try {
                await sendMessengerMessage(senderId, 'Apologies, I encountered an internal error while processing your request. Please try again later.', FB_PAGE_ACCESS_TOKEN, undefined, undefined, undefined, true); // Send quick replies even on error
            } catch (sendError) {
                console.error('Failed to send error message back to user:', sendError);
            }
          }
        }
      }
      console.log('All messaging events processed. Sending 200 OK to Facebook.');
      return { statusCode: 200, body: 'EVENT_RECEIVED' }; // Acknowledge receipt to Facebook
    }
    console.error('Incoming webhook body object is not "page":', body.object);
    return { statusCode: 400, body: 'Bad Request: Not a page object' };
  }

  // --- 3. Handle Other HTTP Methods ---
  console.log(`Received ${event.httpMethod} request (Method Not Allowed).`);
  return { statusCode: 405, body: 'Method Not Allowed' };
};

/**
 * Helper function to send messages back to the Facebook Messenger API.
 * @param recipientId The Messenger user ID to send the message to.
 * @param text The text content of the message.
 * @param token The Facebook Page Access Token.
 * @param imageUrl Optional URL for an image attachment.
 * @param videoUrl Optional URL for a video attachment.
 * @param audioUrl Optional URL for an audio attachment (data URI or public URL).
 * @param includeQuickReplies Whether to include Quick Replies in the response.
 */
async function sendMessengerMessage(
  recipientId: string,
  text: string,
  token: string,
  imageUrl?: string,
  videoUrl?: string,
  audioUrl?: string, // New parameter for audio
  includeQuickReplies: boolean = false
) {
  if (!token) {
    console.error('Facebook Page Access Token is not set for sending message. Cannot send reply.');
    return;
  }

  let messagePayload: any = { recipient: { id: recipientId } };
  let messageContent: any = { text: text };

  if (imageUrl) {
    // Messenger API requires a URL for image attachments.
    // If botImageUrl is a data URI, we need to upload it first or use an external service.
    // For this example, we'll log a warning and send text if it's a data URI.
    if (imageUrl.startsWith('data:')) {
      console.warn('Cannot send data URI directly as Messenger image attachment. Sending as text message with a note.');
      messageContent.text = `${text}\n\n(Note: The edited image could not be sent directly in Messenger as it's a data URI. Please use the web app for a better experience.)`;
      // We don't attach anything if it's a data URI
    } else {
      messageContent = {
        attachment: {
          type: 'image',
          payload: { url: imageUrl, is_reusable: true } // is_reusable: true allows reusing the attachment ID
        }
      };
    }
  } else if (videoUrl) {
    // Similar considerations for video URLs.
    if (videoUrl.startsWith('data:')) {
      console.warn('Cannot send data URI directly as Messenger video attachment. Sending as text message with a note.');
      messageContent.text = `${text}\n\n(Note: The generated video could not be sent directly in Messenger as it's a data URI. Please use the web app for a better experience.)`;
    } else {
      messageContent = {
        attachment: {
          type: 'video',
          payload: { url: videoUrl, is_reusable: true }
        }
      };
    }
  } else if (audioUrl) { // New: Handle audio URL
    // Messenger API requires a URL for audio attachments.
    if (audioUrl.startsWith('data:')) {
      console.warn('Cannot send data URI directly as Messenger audio attachment. Sending as text message with a note.');
      messageContent.text = `${text}\n\n(Note: The generated audio could not be sent directly in Messenger as it's a data URI. Please use the web app for the full experience.)`;
    } else {
      messageContent = {
        attachment: {
          type: 'audio',
          payload: { url: audioUrl, is_reusable: true }
        }
      };
    }
  }

  // Add quick replies if requested
  if (includeQuickReplies) {
    messageContent.quick_replies = [
      { content_type: 'text', title: '💬 Chat & Story', payload: BotFeature.CHAT },
      { content_type: 'text', title: '✂️ Edit Image', payload: BotFeature.EDIT_IMAGE },
      { content_type: 'text', title: '🗓️ Daily Post', payload: BotFeature.DAILY_POST },
      { content_type: 'text', title: '⏰ Schedule Post', payload: BotFeature.SCHEDULE_POST },
    ];
  }
  messagePayload.message = messageContent;


  try {
    const response = await fetch(`https://graph.facebook.com/v19.0/me/messages?access_token=${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(messagePayload),
    });
    const data = await response.json();
    console.log('Messenger API response:', data);
    if (data.error) {
      console.error('Error sending message via Messenger API:', data.error);
    }
  } catch (error) {
    console.error('Failed to send message via Messenger API (network/fetch error):', error);
  }
}

export { handler };