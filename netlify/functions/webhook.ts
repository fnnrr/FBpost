import { Buffer } from 'buffer';
import { Handler, Context, HandlerContext } from '@netlify/functions';
import { MongoClient, Db } from 'mongodb'; // Import MongoClient and Db types
import { GoogleGenAI, Modality } from '@google/genai'; // Added Modality
import { GEMINI_FLASH_MODEL, GEMINI_FLASH_IMAGE_MODEL, GEMINI_FLASH_TTS_MODEL, FB_PAGE_ID } from '../../constants'; // Use constants for model names
import { DailyPostTheme, DailyPostType, BotFeature, PrebuiltVoice } from '../../types'; // Import types for Daily Post and BotFeature, PrebuiltVoice

// Environment variables to be set in Netlify dashboard:
const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME || 'messengerbotdb';
const FB_VERIFY_TOKEN = process.env.FB_VERIFY_TOKEN;
const FB_PAGE_ACCESS_TOKEN = process.env.FB_PAGE_ACCESS_TOKEN;
const API_KEY = process.env.API_KEY;

// Cache database connection
let cachedDb: Db;

async function connectToDatabase(): Promise<Db> {
  if (cachedDb) {
    return cachedDb;
  }
  if (!MONGODB_URI) {
    throw new Error('MONGODB_URI is not set in environment variables.');
  }
  try {
    const client = await MongoClient.connect(MONGODB_URI, {
      connectTimeoutMS: 15000,
      serverSelectionTimeoutMS: 15000,
    });
    const db = client.db(MONGODB_DB_NAME);
    cachedDb = db;
    return db;
  } catch (error) {
    console.error('Failed to connect to MongoDB:', error);
    throw new Error(`MongoDB connection failed: ${error}`);
  }
}

async function fetchAndBase64Encode(url: string, mimeType: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch image from URL: ${url} (Status: ${response.status})`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer).toString('base64');
}

/**
 * Publishes content to Facebook Page using Graph API
 */
async function publishToFacebookPage(text: string, imageUrl?: string): Promise<{ success: boolean; postId?: string; error?: string }> {
  if (!FB_PAGE_ACCESS_TOKEN || !FB_PAGE_ID) {
    return { success: false, error: 'Facebook Page Access Token or ID missing.' };
  }

  try {
    if (imageUrl) {
      // Handle Image Post
      const [mimeTypePart, base64Data] = imageUrl.split(';base64,');
      const mimeType = mimeTypePart ? mimeTypePart.replace('data:', '') : 'image/jpeg';
      const imageBuffer = Buffer.from(base64Data || imageUrl, 'base64'); // Fallback if simple base64

      const formData = new globalThis.FormData();
      formData.append('source', new globalThis.Blob([imageBuffer], { type: mimeType }), 'image.png');
      formData.append('message', text || '');
      formData.append('published', 'true');

      const response = await fetch(`https://graph.facebook.com/v19.0/${FB_PAGE_ID}/photos?access_token=${FB_PAGE_ACCESS_TOKEN}`, {
        method: 'POST',
        body: formData,
      });
      const data = await response.json();
      if (data.error) throw new Error(data.error.message);
      return { success: true, postId: data.id };
    } else {
      // Handle Text Post
      const response = await fetch(`https://graph.facebook.com/v19.0/${FB_PAGE_ID}/feed?access_token=${FB_PAGE_ACCESS_TOKEN}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });
      const data = await response.json();
      if (data.error) throw new Error(data.error.message);
      return { success: true, postId: data.id };
    }
  } catch (error: any) {
    console.error('Error publishing to Facebook:', error);
    return { success: false, error: error.message };
  }
}

const handler: Handler = async (event, context: HandlerContext) => {
  // 1. Webhook Verification
  if (event.httpMethod === 'GET') {
    const query = event.queryStringParameters;
    if (query?.['hub.mode'] === 'subscribe' && query?.['hub.verify_token'] === FB_VERIFY_TOKEN) {
      return { statusCode: 200, body: query['hub.challenge'] };
    }
    return { statusCode: 403, body: 'Forbidden' };
  }

  // 2. Handle Messages
  if (event.httpMethod === 'POST') {
    if (!API_KEY || !FB_PAGE_ACCESS_TOKEN || !MONGODB_URI) {
      return { statusCode: 500, body: JSON.stringify({ message: 'Missing env vars.' }) };
    }

    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return { statusCode: 400, body: 'Invalid JSON' };
    }

    if (body.object === 'page') {
      const db = await connectToDatabase();
      const userContextCollection = db.collection('user_context');

      for (const entry of body.entry) {
        for (const messagingEvent of entry.messaging) {
          const senderId = messagingEvent.sender.id;
          const messageText = messagingEvent.message?.text;
          const quickReplyPayload = messagingEvent.message?.quick_reply?.payload;
          const messageAttachments = messagingEvent.message?.attachments;
          
          const ai = new GoogleGenAI({ apiKey: API_KEY });
          
          let botResponseText = '';
          let botImageUrl: string | undefined;
          let botAudioUrl: string | undefined;
          let sendQuickReplies = false;
          let pendingPostPayload: any = null;

          try {
            const lowerCaseText = messageText?.toLowerCase() || '';

            // --- Check for "Post Confirmation" ---
            if (lowerCaseText === 'yes, post it' || quickReplyPayload === 'CONFIRM_POST') {
              const userContext = await userContextCollection.findOne({ senderId });
              
              if (userContext?.pendingPost) {
                botResponseText = "Publishing to your Page now...";
                await sendMessengerMessage(senderId, botResponseText, FB_PAGE_ACCESS_TOKEN);

                const result = await publishToFacebookPage(userContext.pendingPost.text, userContext.pendingPost.imageUrl);
                
                if (result.success) {
                  botResponseText = `✅ Successfully posted to your Page! (Post ID: ${result.postId})`;
                  // Clear pending post
                  await userContextCollection.updateOne({ senderId }, { $unset: { pendingPost: "" } });
                } else {
                  botResponseText = `❌ Failed to post: ${result.error}`;
                }
              } else {
                botResponseText = "I don't have any recent content stored to post. Try asking me to generate a story or edit an image first!";
              }
              sendQuickReplies = true;
            }
            // --- Normal Generation Logic ---
            else if (lowerCaseText.includes('post') && (lowerCaseText.includes('story') || lowerCaseText.includes('reel') || lowerCaseText.includes('daily post'))) {
               // ... (Simulated generation logic same as before) ...
               // Simplified for brevity, reusing core logic
               const prompt = `Generate a ${lowerCaseText.includes('funny') ? 'funny' : 'inspirational'} social media post about ${lowerCaseText.replace(/post|story|reel|daily/g, '').trim() || 'life'}. Keep it under 200 words.`;
               
               const response = await ai.models.generateContent({ model: GEMINI_FLASH_MODEL, contents: prompt });
               const generatedText = response.text || "Could not generate text.";
               
               botResponseText = `Here is your generated post:\n\n${generatedText}\n\nDo you want me to publish this to your Facebook Page immediately?`;
               
               // Store this as a pending post
               pendingPostPayload = { text: generatedText };
               sendQuickReplies = true;

            } else if (lowerCaseText.startsWith('edit this image:') && messageAttachments?.length > 0) {
               const attachment = messageAttachments[0];
               if (attachment.type === 'image') {
                 const editPrompt = messageText.substring(16).trim();
                 botResponseText = `Editing image with: "${editPrompt}"...`;
                 await sendMessengerMessage(senderId, botResponseText, FB_PAGE_ACCESS_TOKEN);

                 const base64Data = await fetchAndBase64Encode(attachment.payload.url, attachment.mimeType || 'image/jpeg');
                 const response = await ai.models.generateContent({
                    model: GEMINI_FLASH_IMAGE_MODEL,
                    contents: { parts: [{ inlineData: { data: base64Data, mimeType: attachment.mimeType || 'image/jpeg' } }, { text: editPrompt }] }
                 });

                 for (const part of response.candidates?.[0]?.content?.parts || []) {
                    if (part.inlineData?.data) {
                        botImageUrl = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
                        botResponseText = "Here is your edited image. Want to post it?";
                        pendingPostPayload = { text: `Edited image: ${editPrompt}`, imageUrl: botImageUrl };
                        break;
                    }
                 }
               }
               sendQuickReplies = true;
            } else {
               // Default Chat
               const chatRes = await ai.models.generateContent({
                  model: GEMINI_FLASH_MODEL,
                  contents: `User said: "${messageText}". Respond as a helpful bot. If they want to create content, guide them.`
               });
               botResponseText = chatRes.text || "How can I help?";
               sendQuickReplies = true;
            }

            // --- Update Context & Send Reply ---
            if (pendingPostPayload) {
              await userContextCollection.updateOne(
                { senderId },
                { $set: { pendingPost: pendingPostPayload, lastInteraction: new Date() } },
                { upsert: true }
              );
            }

            await sendMessengerMessage(senderId, botResponseText, FB_PAGE_ACCESS_TOKEN, botImageUrl, undefined, botAudioUrl, sendQuickReplies, !!pendingPostPayload);

          } catch (e: any) {
            console.error('Error:', e);
            await sendMessengerMessage(senderId, "Sorry, I encountered an error.", FB_PAGE_ACCESS_TOKEN);
          }
        }
      }
      return { statusCode: 200, body: 'EVENT_RECEIVED' };
    }
    return { statusCode: 400, body: 'Bad Request' };
  }
  return { statusCode: 405, body: 'Method Not Allowed' };
};

async function sendMessengerMessage(
  recipientId: string,
  text: string,
  token: string,
  imageUrl?: string,
  videoUrl?: string,
  audioUrl?: string,
  includeQuickReplies: boolean = false,
  offerPostConfirmation: boolean = false
) {
  let messageContent: any = { text: text };

  if (imageUrl && !imageUrl.startsWith('data:')) {
      messageContent = { attachment: { type: 'image', payload: { url: imageUrl, is_reusable: true } } };
  } else if (imageUrl) {
      // Data URI workaround: send text note, image can't be sent directly easily in generic Messenger response without upload
      messageContent.text = text + "\n\n(Image generated internally. Type 'Yes, post it' to publish content to Page)";
  }

  if (includeQuickReplies) {
    messageContent.quick_replies = [
      { content_type: 'text', title: '💬 Chat', payload: BotFeature.CHAT },
      { content_type: 'text', title: '🗓️ Daily Post', payload: BotFeature.DAILY_POST },
    ];
    if (offerPostConfirmation) {
       messageContent.quick_replies.unshift({ content_type: 'text', title: '🚀 Yes, Post It', payload: 'CONFIRM_POST' });
    }
  }

  await fetch(`https://graph.facebook.com/v19.0/me/messages?access_token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipient: { id: recipientId }, message: messageContent }),
  });
}

export { handler };