// IMPORTANT: All calls to GoogleGenAI must now go through the Netlify Function `geminiProxy.ts`
// This file acts as the client-side interface for Gemini-powered features.

import { GroundingUrl, PrebuiltVoice } from '../types';

// Utility function to convert File to base64
async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1]); // Only return the base64 data part
    reader.onerror = (error) => reject(error);
    reader.readAsDataURL(file);
  });
}

export const generateTextContent = async (
  prompt: string,
  useGoogleSearch: boolean = false,
  enableTTS: boolean = false,
  voiceName: PrebuiltVoice = PrebuiltVoice.ZEPHYR,
): Promise<{ text: string; groundingUrls?: GroundingUrl[]; audioUrl?: string; }> => {
  try {
    const response = await fetch('/netlify/functions/geminiProxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        feature: 'textGeneration',
        prompt,
        useGoogleSearch,
        enableTTS,
        voiceName,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text(); // Read raw text for better debugging
      console.error('GeminiProxy textGeneration failed with status:', response.status, 'Response:', errorBody);
      try {
        const errorJson = JSON.parse(errorBody);
        throw new Error(errorJson.error || `Server responded with status ${response.status} and unexpected format.`);
      } catch (parseError) {
        throw new Error(`Server responded with status ${response.status} and non-JSON: ${errorBody.substring(0, 200)}...`);
      }
    }

    const result = await response.json();

    if (result.error) {
      throw new Error(result.error);
    }

    return {
      text: result.text,
      groundingUrls: result.groundingUrls,
      audioUrl: result.audioUrl,
    };
  } catch (error: any) {
    console.error('Error generating text content via proxy:', error);
    throw new Error(`Failed to generate content: ${error.message || 'Unknown error'}`);
  }
};

export const editImage = async (imageFile: File, prompt: string): Promise<string> => {
  try {
    const base64ImageData = await fileToBase64(imageFile);
    const response = await fetch('/netlify/functions/geminiProxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        feature: 'imageEdit',
        prompt,
        imageFile: {
          base64Data: base64ImageData,
          mimeType: imageFile.type,
        },
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text(); // Read raw text for better debugging
      console.error('GeminiProxy imageEdit failed with status:', response.status, 'Response:', errorBody);
      try {
        const errorJson = JSON.parse(errorBody);
        throw new Error(errorJson.error || `Server responded with status ${response.status} and unexpected format.`);
      } catch (parseError) {
        throw new Error(`Server responded with status ${response.status} and non-JSON: ${errorBody.substring(0, 200)}...`);
      }
    }

    const result = await response.json();

    if (result.error) {
      throw new Error(result.error);
    }

    return result.imageUrl;
  } catch (error: any) {
    console.error('Error editing image via proxy:', error);
    throw new Error(`Failed to edit image: ${error.message || 'Unknown error'}`);
  }
};