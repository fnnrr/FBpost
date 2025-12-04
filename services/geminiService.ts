import { GoogleGenAI, GenerateContentResponse } from '@google/genai';
import {
  GEMINI_FLASH_MODEL,
  GEMINI_FLASH_IMAGE_MODEL,
} from '../constants';
import { GroundingUrl } from '../types';

// Utility function to convert File to base64
async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = (error) => reject(error);
    reader.readAsDataURL(file);
  });
}

// Utility function to decode base64 to Uint8Array for audio (retained for future potential audio features if needed)
function decodeBase64(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

// Utility function to get grounding URLs
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

export const generateTextContent = async (prompt: string, useGoogleSearch: boolean = false): Promise<{ text: string; groundingUrls?: GroundingUrl[]; }> => {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const config: any = {};
    if (useGoogleSearch) {
      config.tools = [{ googleSearch: {} }];
    }

    const response: GenerateContentResponse = await ai.models.generateContent({
      model: GEMINI_FLASH_MODEL,
      contents: prompt,
      config: config,
    });
    const text = response.text;
    const groundingUrls = getGroundingUrls(response);
    return { text: text || 'No text response received.', groundingUrls };
  } catch (error: any) {
    console.error('Error generating text content:', error);
    throw new Error(`Failed to generate text content: ${error.message || 'Unknown error'}`);
  }
};

export const editImage = async (imageFile: File, prompt: string): Promise<string> => {
  try {
    const base64ImageData = await fileToBase64(imageFile);
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const response = await ai.models.generateContent({
      model: GEMINI_FLASH_IMAGE_MODEL,
      contents: {
        parts: [
          {
            inlineData: {
              data: base64ImageData,
              mimeType: imageFile.type,
            },
          },
          {
            text: prompt,
          },
        ],
      },
    });

    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData?.data && part.inlineData.mimeType) {
        return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
      }
    }
    throw new Error('No edited image part found in the response.');
  } catch (error: any) {
    console.error('Error editing image:', error);
    throw new Error(`Failed to edit image: ${error.message || 'Unknown error'}`);
  }
};