import { Handler, HandlerContext } from '@netlify/functions'; // Corrected import to HandlerContext
import { MongoClient, Db } from 'mongodb';
import { createHmac } from 'crypto'; // For HMAC verification
import { FB_APP_SECRET } from '../../constants'; // Import FB_APP_SECRET from constants

// Environment variables:
// MONGODB_URI: Your MongoDB connection string
// MONGODB_DB_NAME: The name of your database (e.g., 'messengerbotdb')

const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME || 'messengerbotdb';
const PRIVACY_POLICY_URL = process.env.URL ? `${process.env.URL}/privacy-policy` : 'YOUR_APP_BASE_URL/privacy-policy'; // dynamically get base URL

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
    console.log('Attempting to establish new MongoDB connection for deletion...');
    const client = await MongoClient.connect(MONGODB_URI, {
      connectTimeoutMS: 15000,
      serverSelectionTimeoutMS: 15000,
    });
    const db = client.db(MONGODB_DB_NAME);
    cachedDb = db;
    console.log('Successfully connected to MongoDB for deletion.');
    return db;
  } catch (error) {
    console.error('Failed to connect to MongoDB for deletion:', error);
    throw new Error(`MongoDB connection failed: ${error}`);
  }
}

/**
 * Verifies Facebook's `signed_request`.
 * @param signedRequest The base64url encoded signed_request string from Facebook.
 * @param appSecret Your Facebook App Secret.
 * @returns The decoded payload if valid, otherwise null.
 */
function verifySignedRequest(signedRequest: string, appSecret: string): any | null {
  if (!signedRequest || !appSecret) {
    console.error('Signed request or App Secret missing for verification.');
    return null;
  }

  const parts = signedRequest.split('.');
  if (parts.length !== 2) {
    console.error('Invalid signed_request format.');
    return null;
  }

  const encodedSignature = parts[0];
  const encodedPayload = parts[1];

  // Decode the signature and payload
  const signature = Buffer.from(encodedSignature.replace(/-/g, '+').replace(/_/g, '/'), 'base64url');
  const payload = Buffer.from(encodedPayload.replace(/-/g, '+').replace(/_/g, '/'), 'base64url').toString('utf8');

  // Compute expected signature
  const hmac = createHmac('sha256', appSecret);
  hmac.update(encodedPayload);
  const expectedSignature = hmac.digest();

  // Compare signatures
  if (!signature.equals(expectedSignature)) {
    console.error('Invalid signature. Request might be forged.');
    return null;
  }

  try {
    return JSON.parse(payload);
  } catch (e) {
    console.error('Failed to parse signed_request payload:', e);
    return null;
  }
}

// Fix: Changed `Context` to `HandlerContext` for type compatibility.
const handler: Handler = async (event, context: HandlerContext) => {
  if (event.httpMethod !== 'POST') {
    console.log(`Received ${event.httpMethod} request (Method Not Allowed).`);
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  if (!FB_APP_SECRET) {
    console.error('FB_APP_SECRET is not set in environment variables. Cannot process data deletion requests.');
    return {
      statusCode: 500,
      body: JSON.stringify({ message: 'FB_APP_SECRET is not configured.' }),
    };
  }
  if (!MONGODB_URI) {
    console.error('MONGODB_URI is not set in environment variables. Cannot process data deletion requests.');
    return {
      statusCode: 500,
      body: JSON.stringify({ message: 'MONGODB_URI is not configured.' }),
    };
  }

  console.log('Received POST request for data deletion webhook, parsing body...');
  let body;
  try {
    body = JSON.parse(event.body || '{}');
    console.log('Parsed data deletion webhook body.');
  } catch (e) {
    console.error('Failed to parse incoming webhook body (invalid JSON):', e);
    return { statusCode: 400, body: 'Invalid JSON payload' };
  }

  const signedRequest = body.signed_request;
  if (!signedRequest) {
    console.error('Missing signed_request in deletion payload.');
    return { statusCode: 400, body: 'Missing signed_request' };
  }

  const decodedSignedRequest = verifySignedRequest(signedRequest, FB_APP_SECRET);

  if (!decodedSignedRequest || !decodedSignedRequest.user_id) {
    console.error('Invalid or unverified signed_request received. Aborting data deletion.');
    return { statusCode: 403, body: 'Invalid signed_request' };
  }

  const userId = decodedSignedRequest.user_id;
  console.log(`Verified data deletion request for user ID: ${userId}`);

  try {
    const db = await connectToDatabase();
    const incomingMessagesCollection = db.collection('incoming_messages');

    console.log(`Attempting to delete all messages for user ID: ${userId} from MongoDB...`);
    const deleteResult = await incomingMessagesCollection.deleteMany({ senderId: userId });
    console.log(`Deleted ${deleteResult.deletedCount} messages for user ID: ${userId}.`);

    // Facebook requires a URL and a confirmation code in the response.
    // The URL should be a status page or privacy policy page where the user can confirm.
    // The confirmation code can be a simple UUID or a derived token.
    const confirmationCode = `deleted-${userId}-${Date.now()}`;
    const responsePayload = {
      url: PRIVACY_POLICY_URL, // Points to your privacy policy where deletion instructions are.
      confirmation_code: confirmationCode,
    };

    console.log('Successfully processed data deletion. Sending response to Facebook:', responsePayload);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(responsePayload),
    };

  } catch (error: any) {
    console.error(`Error during data deletion for user ${userId}:`, error);
    return {
      statusCode: 500,
      body: JSON.stringify({ message: `Internal server error during data deletion: ${error.message || 'Unknown error'}` }),
    };
  }
};

export { handler };