import { Handler, HandlerContext } from '@netlify/functions';
import { FB_PAGE_ACCESS_TOKEN, FB_PAGE_ID } from '../../constants'; // Use constants for access token and page ID

/**
 * Handles publishing content to a Facebook Page via the Graph API.
 * Supports text-only posts and image posts (with text).
 */
const handler: Handler = async (event, context: HandlerContext) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // Ensure necessary environment variables are set
  if (!FB_PAGE_ACCESS_TOKEN || !FB_PAGE_ID) {
    console.error('FB_PAGE_ACCESS_TOKEN or FB_PAGE_ID is not set in environment variables. Cannot publish to Facebook.');
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: 'Facebook Page Access Token or Page ID not configured.' }),
    };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    console.error('Failed to parse incoming webhook body (invalid JSON):', e);
    return { statusCode: 400, body: 'Invalid JSON payload' };
  }

  const { text, imageUrl } = body; // imageUrl is expected as a data URI (base64 string)
  console.log('Received request to publish to Facebook:', { text: text?.substring(0, 100) + '...', hasImage: !!imageUrl });

  if (!text && !imageUrl) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: 'No text or image content provided for publishing.' }),
    };
  }

  try {
    // Fix: Declare postId at the beginning of the try block.
    let postId: string | undefined;

    if (imageUrl) {
      console.log('Detected image data URI. Preparing for multipart upload...');
      const [mimeTypePart, base64Data] = imageUrl.split(';base64,');
      if (!mimeTypePart || !base64Data) {
        throw new Error('Invalid image data URI format.');
      }
      const mimeType = mimeTypePart.replace('data:', '');

      // Facebook Graph API allows direct upload of image bytes.
      // We need to decode the base64 string to a Buffer.
      const imageBuffer = Buffer.from(base64Data, 'base64');

      // Fix: Use globalThis.FormData and globalThis.Blob for explicit global reference in Node.js environments
      const formData = new globalThis.FormData();
      // The 'source' field is for the actual image file
      formData.append('source', new globalThis.Blob([imageBuffer], { type: mimeType }), 'image.png'); // Or image.jpeg based on mimeType
      formData.append('message', text || ''); // Attach the text as the message/caption
      formData.append('published', 'true'); // Directly publish the photo

      const fbUploadResponse = await fetch(`https://graph.facebook.com/v19.0/${FB_PAGE_ID}/photos?access_token=${FB_PAGE_ACCESS_TOKEN}`, {
        method: 'POST',
        body: formData, // fetch will set Content-Type: multipart/form-data automatically
      });

      const fbUploadData = await fbUploadResponse.json();
      console.log('Facebook image upload response:', fbUploadData);

      if (!fbUploadResponse.ok || fbUploadData.error) {
        throw new Error(fbUploadData.error?.message || 'Failed to upload image to Facebook.');
      }
      postId = fbUploadData.id; // The ID of the created post/photo
      console.log(`Image successfully uploaded and posted with ID: ${postId}`);
    } else {
      // Text-only post
      // Fix: Change console() to console.log()
      console.log('Attempting to create text-only post...');
      const fbResponse = await fetch(`https://graph.facebook.com/v19.0/${FB_PAGE_ID}/feed?access_token=${FB_PAGE_ACCESS_TOKEN}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
        }),
      });

      const fbData = await fbResponse.json();
      console.log('Facebook text post response:', fbData);

      if (!fbResponse.ok || fbData.error) {
        throw new Error(fbData.error?.message || 'Failed to create text post on Facebook.');
      }
      postId = fbData.id;
      console.log(`Text post created with ID: ${postId}`);
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, postId: postId }),
    };

  } catch (error: any) {
    console.error('Error publishing to Facebook:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: error.message || 'An unknown error occurred during Facebook publishing.' }),
    };
  }
};

export { handler };