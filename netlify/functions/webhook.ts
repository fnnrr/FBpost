import { Handler, Context, HandlerContext } from '@netlify/functions';
import { MongoClient, Db } from 'mongodb'; // Import MongoClient and Db types
import { GoogleGenAI } from '@google/genai';
import { GEMINI_FLASH_MODEL, GEMINI_FLASH_IMAGE_MODEL } from '../../constants'; // Use constants for model names
import { DailyPostTheme, DailyPostType } from '../../types'; // Import types for Daily Post

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
    return cachedDb;
  }
  if (!MONGODB_URI) {
    throw new Error('MONGODB_URI is not set in environment variables.');
  }

  try {
    const client = await MongoClient.connect(MONGODB_URI);
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
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch image from URL: ${url} (Status: ${response.status})`);
  }
  const arrayBuffer = await response.arrayBuffer();
  // Buffer is globally available in Node.js environments like Netlify Functions
  const base64 = Buffer.from(arrayBuffer).toString('base64');
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
    } catch (e) {
      console.error('Failed to parse incoming webhook body (invalid JSON):', e);
      return { statusCode: 400, body: 'Invalid JSON payload' };
    }

    if (body.object === 'page') {
      for (const entry of body.entry) {
        for (const messagingEvent of entry.messaging) {
          const senderId = messagingEvent.sender.id;
          const messageText = messagingEvent.message?.text;
          const messageAttachments = messagingEvent.message?.attachments; // Handle attachments (e.g., images)
          const timestamp = new Date();

          // Initialize Gemini API client (do this per-request in serverless to ensure latest API key if it changes)
          const ai = new GoogleGenAI({ apiKey: API_KEY });

          try {
            // Connect to MongoDB
            const db = await connectToDatabase();
            const incomingMessagesCollection = db.collection('incoming_messages'); // Example collection

            // Store the incoming message in MongoDB (example usage)
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
            // let botVideoUrl: string | undefined; // Video generation is not currently enabled in frontend or backend

            if (messageText) {
                const lowerCaseText = messageText.toLowerCase();

                if (lowerCaseText.startsWith('daily post')) {
                  // Example: "daily post inspirational story_reel" or "daily post funny regular_post"
                  const parts = lowerCaseText.split(' ');
                  const themePart = parts[2];
                  const typePart = parts[3];

                  const theme: DailyPostTheme = (['inspirational', 'sad', 'storytelling', 'funny'] as DailyPostTheme[]).includes(themePart as DailyPostTheme)
                    ? (themePart as DailyPostTheme)
                    : 'inspirational'; // Default
                  const type: DailyPostType = (['story_reel', 'regular_post'] as DailyPostType[]).includes(typePart as DailyPostType)
                    ? (typePart as DailyPostType)
                    : 'story_reel'; // Default

                  let prompt = '';
                  if (type === 'story_reel') {
                    prompt = `Generate a short ${theme} themed story or inspirational message suitable for a social media reel/story. Keep it concise, around 100-150 words.`;
                  } else { // regular_post
                    prompt = `Generate a detailed ${theme} themed story or message suitable for a regular social media post. Make it engaging and provide a clear narrative or insightful reflection, around 200-300 words.`;
                  }

                  const geminiResponse = await ai.models.generateContent({
                    model: GEMINI_FLASH_MODEL,
                    contents: prompt,
                  });
                  botResponseText = `Daily Post (${theme} - ${type.replace('_', ' ')}):\n\n${geminiResponse.text || 'Could not generate post.'}`;

                } else if (lowerCaseText.startsWith('edit this image:') && messageAttachments?.length > 0) {
                  // Example: "edit this image: add a hat" (with an attached image)
                  const attachment = messageAttachments[0];
                  if (attachment.type === 'image' && attachment.payload.url) {
                    const editPrompt = messageText.substring('edit this image:'.length).trim();
                    if (!editPrompt) {
                        botResponseText = "Please tell me how you want to edit the image after 'edit this image:'.";
                    } else {
                        botResponseText = `Editing your image with prompt: "${editPrompt}"... This might take a moment.`;
                        await sendMessengerMessage(senderId, botResponseText, FB_PAGE_ACCESS_TOKEN); // Send initial thinking message

                        try {
                            const base64ImageData = await fetchAndBase64Encode(attachment.payload.url, attachment.mimeType || 'image/jpeg');
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
                } else if (lowerCaseText.startsWith('schedule post')) {
                  // This feature is more complex as it requires a persistent scheduler
                  // and possibly user input for time. For now, it's a placeholder.
                  botResponseText = "Scheduling posts is not fully implemented in the backend yet. You can use the frontend app to simulate scheduling. In the future, I will be able to schedule posts to your social media.";
                } else {
                  // Default chat response using Gemini
                  const geminiResponse = await ai.models.generateContent({
                      model: GEMINI_FLASH_MODEL,
                      contents: `The user said: "${messageText}". Respond in the style of a helpful social media assistant, suggesting creative post or story ideas, or offering to help with image/video generation based on their query.`,
                  });
                  botResponseText = geminiResponse.text || botResponseText;
                }
            } else if (messageAttachments && messageAttachments.length > 0) {
              // Generic handling for attachments without a specific command
              botResponseText = "I received an attachment! To edit an image, please use the format 'edit this image: [your prompt]' and attach the image.";
            }

            // --- Send Response back to Messenger ---
            await sendMessengerMessage(senderId, botResponseText, FB_PAGE_ACCESS_TOKEN, botImageUrl); // Pass botImageUrl here

          } catch (error) {
            console.error(`Error processing Messenger event for ${senderId} or interacting with DB/Gemini:`, error);
            await sendMessengerMessage(senderId, 'Apologies, I encountered an internal error while processing your request. Please try again later.', FB_PAGE_ACCESS_TOKEN);
          }
        }
      }
      return { statusCode: 200, body: 'EVENT_RECEIVED' }; // Acknowledge receipt to Facebook
    }
    console.error('Incoming webhook body object is not "page":', body.object);
    return { statusCode: 400, body: 'Bad Request: Not a page object' };
  }

  // --- 3. Handle Other HTTP Methods ---
  return { statusCode: 405, body: 'Method Not Allowed' };
};

/**
 * Helper function to send messages back to the Facebook Messenger API.
 * @param recipientId The Messenger user ID to send the message to.
 * @param text The text content of the message.
 * @param token The Facebook Page Access Token.
 * @param imageUrl Optional URL for an image attachment.
 * @param videoUrl Optional URL for a video attachment.
 */
async function sendMessengerMessage(
  recipientId: string,
  text: string,
  token: string,
  imageUrl?: string,
  videoUrl?: string
) {
  if (!token) {
    console.error('Facebook Page Access Token is not set for sending message. Cannot send reply.');
    return;
  }

  let messagePayload: any = { recipient: { id: recipientId } };

  if (imageUrl) {
    // Messenger API requires a URL for image attachments.
    // If botImageUrl is a data URI, we need to upload it first or use an external service.
    // For simplicity, let's assume direct URL or a workaround for data URIs if necessary.
    // A data URI cannot be directly used here. A proper solution would upload the image to a CDN
    // or Facebook's attachment API first, then use the returned URL.
    // For this example, we'll log a warning and send text if it's a data URI.
    if (imageUrl.startsWith('data:')) {
      console.warn('Cannot send data URI directly as Messenger image attachment. Sending as text message with image URL (if supported by client).');
      messagePayload.message = { text: `${text}\n\n[Image could not be sent directly via Messenger API as data URI. Here's the data URI for reference: ${imageUrl.substring(0, 100)}...]` };
    } else {
      messagePayload.message = {
        attachment: {
          type: 'image',
          payload: { url: imageUrl, is_reusable: true } // is_reusable: true allows reusing the attachment ID
        }
      };
    }
  } else if (videoUrl) {
    // Similar considerations for video URLs.
    if (videoUrl.startsWith('data:')) {
      console.warn('Cannot send data URI directly as Messenger video attachment. Sending as text message with video URL.');
      messagePayload.message = { text: `${text}\n\n[Video could not be sent directly via Messenger API as data URI. Here's the data URI for reference: ${videoUrl.substring(0, 100)}...]` };
    } else {
      messagePayload.message = {
        attachment: {
          type: 'video',
          payload: { url: videoUrl, is_reusable: true }
        }
      };
    }
  } else {
    messagePayload.message = { text: text };
  }

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