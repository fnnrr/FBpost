import { Handler, HandlerContext } from '@netlify/functions';
import { GoogleGenAI, GenerateContentResponse, Modality } from '@google/genai';
import {
  GEMINI_FLASH_MODEL,
  GEMINI_FLASH_IMAGE_MODEL,
  GEMINI_FLASH_TTS_MODEL,
} from '../../constants';
import { GroundingUrl, PrebuiltVoice } from '../../types';

// Utility function to decode base64 to Uint8Array for audio (copied from services/geminiService.ts)
function decodeBase64(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

// Helper to write string to DataView for WAV header (copied from services/geminiService.ts)
function writeString(view: DataView, offset: number, s: string) {
  for (let i = 0; i < s.length; i++) {
    view.setUint8(offset + i, s.charCodeAt(i));
  }
}

// Helper to create a WAV header for raw PCM audio (copied from services/geminiService.ts)
function createWavHeader(sampleRate: number, numChannels: number, pcmDataLength: number): Uint8Array {
  const headerLength = 44;
  const totalLength = pcmDataLength + headerLength;
  const buffer = new ArrayBuffer(headerLength);
  const view = new DataView(buffer);

  // RIFF chunk descriptor
  writeString(view, 0, 'RIFF'); // ChunkID
  view.setUint32(4, totalLength - 8, true); // ChunkSize
  writeString(view, 8, 'WAVE'); // Format

  // FMT sub-chunk
  writeString(view, 12, 'fmt '); // Subchunk1ID
  view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
  view.setUint16(20, 1, true); // AudioFormat (1 for PCM)
  view.setUint16(22, numChannels, true); // NumChannels
  view.setUint32(24, sampleRate, true); // SampleRate
  view.setUint32(28, sampleRate * numChannels * 2, true); // ByteRate (SampleRate * NumChannels * BitsPerSample/8)
  view.setUint16(32, numChannels * 2, true); // BlockAlign (NumChannels * BitsPerSample/8)
  view.setUint16(34, 16, true); // BitsPerSample (16-bit PCM)

  // Data sub-chunk
  writeString(view, 36, 'data'); // Subchunk2ID
  view.setUint32(40, pcmDataLength, true); // Subchunk2Size

  return new Uint8Array(buffer);
}

// Utility function to get grounding URLs (copied from services/geminiService.ts)
function getGroundingUrls(response: GenerateContentResponse): GroundingUrl[] | undefined {
  const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
  if (!groundingChunks || groundingChunks.length === 0) {
    return undefined;
  }
  const urls: GroundingUrl[] = [];
  for (const chunk of groundingChunks) {
    if (chunk.web?.uri) {
      urls.push({ uri: chunk.web.uri, title: chunk.web.title });
    }
    if (chunk.maps) {
      if (chunk.maps.uri) {
        urls.push({ uri: chunk.maps.uri, title: chunk.maps.title });
      }
    }
  }
  return urls.length > 0 ? urls : undefined;
}


const handler: Handler = async (event, context: HandlerContext) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const API_KEY = process.env.API_KEY;
  if (!API_KEY) {
    console.error('API_KEY is not set in environment variables.');
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: 'Google Gemini API key not configured on server.' }),
    };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    console.error('Failed to parse incoming request body:', e);
    return { statusCode: 400, body: 'Invalid JSON payload' };
  }

  const { feature, prompt, useGoogleSearch, enableTTS, voiceName, imageFile } = body;
  console.log(`GeminiProxy: Received feature '${feature}' with prompt: '${prompt?.substring(0, 50)}...'`);

  const ai = new GoogleGenAI({ apiKey: API_KEY });

  try {
    switch (feature) {
      case 'textGeneration': {
        const config: any = {};
        if (useGoogleSearch) {
          config.tools = [{ googleSearch: {} }];
        }

        let textResponse: string | undefined;
        let audioUrl: string | undefined;
        let groundingUrls: GroundingUrl[] | undefined;

        // First, get the text content (always needed)
        const textGenResponse: GenerateContentResponse = await ai.models.generateContent({
          model: GEMINI_FLASH_MODEL,
          contents: prompt,
          config: config,
        });
        textResponse = textGenResponse.text;
        groundingUrls = getGroundingUrls(textGenResponse);

        if (enableTTS && textResponse) {
          console.log(`GeminiProxy: Generating speech for text: "${textResponse.substring(0, 50)}..." with voice: ${voiceName}`);
          const ttsResponse: GenerateContentResponse = await ai.models.generateContent({
            model: GEMINI_FLASH_TTS_MODEL,
            contents: [{ parts: [{ text: textResponse }] }],
            config: {
              responseModalities: [Modality.AUDIO],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: { voiceName: voiceName as PrebuiltVoice }, // Cast as PrebuiltVoice
                },
              },
            },
          });

          const base64Audio = ttsResponse.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
          if (base64Audio) {
            const rawPcmBytes = decodeBase64(base64Audio);
            const sampleRate = 24000;
            const numChannels = 1;
            const wavHeader = createWavHeader(sampleRate, numChannels, rawPcmBytes.length);

            const fullWavBytes = new Uint8Array(wavHeader.length + rawPcmBytes.length);
            fullWavBytes.set(wavHeader, 0);
            fullWavBytes.set(rawPcmBytes, wavHeader.length);

            let binary = '';
            const len = fullWavBytes.byteLength;
            for (let i = 0; i < len; i++) {
              binary += String.fromCharCode(fullWavBytes[i]);
            }
            audioUrl = `data:audio/wav;base64,${btoa(binary)}`;
          } else {
            console.warn('GeminiProxy: No audio data received from TTS model.');
          }
        }

        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: textResponse || 'No text response received.',
            groundingUrls,
            audioUrl,
          }),
        };
      }

      case 'imageEdit': {
        if (!imageFile || !imageFile.base64Data || !imageFile.mimeType) {
          return {
            statusCode: 400,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ success: false, error: 'Image file data is missing for editing.' }),
          };
        }

        console.log(`GeminiProxy: Editing image with prompt: '${prompt}'`);
        const response = await ai.models.generateContent({
          model: GEMINI_FLASH_IMAGE_MODEL,
          contents: {
            parts: [
              {
                inlineData: {
                  data: imageFile.base64Data,
                  mimeType: imageFile.mimeType,
                },
              },
              {
                text: prompt,
              },
            ],
          },
        });

        let editedImageUrl: string | undefined;
        for (const part of response.candidates?.[0]?.content?.parts || []) {
          if (part.inlineData?.data && part.inlineData.mimeType) {
            editedImageUrl = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
            break;
          }
        }

        if (!editedImageUrl) {
          throw new Error('No edited image part found in the response.');
        }

        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageUrl: editedImageUrl }),
        };
      }

      default:
        return {
          statusCode: 400,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: false, error: 'Unsupported Gemini feature requested.' }),
        };
    }
  } catch (error: any) {
    console.error(`GeminiProxy Error during '${feature}' feature:`, error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: error.message || `An unknown error occurred during Gemini '${feature}' operation.` }),
    };
  }
};

export { handler };