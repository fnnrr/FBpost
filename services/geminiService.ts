import { GoogleGenAI, GenerateContentResponse } from '@google/genai';
import {
  GEMINI_FLASH_MODEL,
  GEMINI_FLASH_IMAGE_MODEL,
  GEMINI_PRO_IMAGE_MODEL,
  VEO_FAST_GENERATE_MODEL,
  BILLING_DOCS_URL,
} from '../constants';
import { ImageSize, VideoAspectRatio, GroundingUrl } from '../types';

// Utility function to convert File to base64
async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = (error) => reject(error);
    reader.readAsDataURL(file);
  });
}

// Utility function to decode base64 to Uint8Array for audio
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
    if (chunk.maps?.uri) {
      urls.push({ uri: chunk.maps.uri, title: chunk.maps.title });
      if (chunk.maps.placeAnswerSources) {
        for (const source of chunk.maps.placeAnswerSources) {
          if (source.reviewSnippets) {
            for (const snippet of source.reviewSnippets) {
              if (snippet.uri) {
                urls.push({ uri: snippet.uri, title: snippet.title });
              }
            }
          }
        }
      }
    }
  }
  return urls.length > 0 ? urls : undefined;
}

export const checkAndPromptApiKey = async (): Promise<boolean> => {
  if (window.aistudio && typeof window.aistudio.hasSelectedApiKey === 'function' && typeof window.aistudio.openSelectKey === 'function') {
    const hasKey = await window.aistudio.hasSelectedApiKey();
    if (!hasKey) {
      alert(`A paid API key is required for this feature (Veo video generation and Gemini 3 Pro image generation). Please select one from a paid GCP project.`);
      await window.aistudio.openSelectKey();
      // Assume success after opening the dialog, as per guidelines to avoid race conditions.
      // The new key will be picked up when GoogleGenAI is instantiated for the next API call.
      return true;
    }
    return true;
  } else {
    console.warn("window.aistudio API not available. Cannot check/prompt for API key.");
    // In a development environment without the AI Studio runtime, assume API_KEY is set via .env or similar.
    return !!process.env.API_KEY;
  }
};

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

export const generateImage = async (prompt: string, imageSize: ImageSize): Promise<string> => {
  const apiKeyAvailable = await checkAndPromptApiKey();
  if (!apiKeyAvailable) {
    throw new Error('API key not selected. Please select a paid API key.');
  }

  try {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const response = await ai.models.generateContent({
      model: GEMINI_PRO_IMAGE_MODEL,
      contents: {
        parts: [
          {
            text: prompt,
          },
        ],
      },
      config: {
        imageConfig: {
          aspectRatio: '1:1', // Default to 1:1, as user only specified size
          imageSize: imageSize,
        },
      },
    });

    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData?.data && part.inlineData.mimeType) {
        return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
      }
    }
    throw new Error('No image part found in the response.');
  } catch (error: any) {
    console.error('Error generating image:', error);
    if (error.message.includes("Requested entity was not found.")) {
      throw new Error(`API key might be invalid or not from a paid project. Please select a valid key. See billing info: ${BILLING_DOCS_URL}`);
    }
    throw new Error(`Failed to generate image: ${error.message || 'Unknown error'}`);
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

export const generateVideo = async (imageFile: File | null, prompt: string | null, aspectRatio: VideoAspectRatio): Promise<string> => {
  const apiKeyAvailable = await checkAndPromptApiKey();
  if (!apiKeyAvailable) {
    throw new Error('API key not selected. Please select a paid API key.');
  }

  try {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    let payload: any = {
      model: VEO_FAST_GENERATE_MODEL,
      config: {
        numberOfVideos: 1,
        resolution: '720p', // Default to 720p, as user didn't specify.
        aspectRatio: aspectRatio,
      },
    };

    if (prompt) {
      payload.prompt = prompt;
    }
    if (imageFile) {
      const base64ImageData = await fileToBase64(imageFile);
      payload.image = {
        imageBytes: base64ImageData,
        mimeType: imageFile.type,
      };
    }

    let operation = await ai.models.generateVideos(payload);

    while (!operation.done) {
      await new Promise((resolve) => setTimeout(resolve, 10000)); // Poll every 10 seconds
      operation = await ai.operations.getVideosOperation({ operation: operation });
    }

    const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
    if (downloadLink) {
      // Append API key to the download link for fetching
      return `${downloadLink}&key=${process.env.API_KEY}`;
    } else {
      throw new Error('No video URI found in the response.');
    }
  } catch (error: any) {
    console.error('Error generating video:', error);
    if (error.message.includes("Requested entity was not found.")) {
      throw new Error(`API key might be invalid or not from a paid project. Please select a valid key. See billing info: ${BILLING_DOCS_URL}`);
    }
    throw new Error(`Failed to generate video: ${error.message || 'Unknown error'}`);
  }
};
