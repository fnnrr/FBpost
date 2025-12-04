import { GoogleGenAI, Modality } from "@google/genai";
import { GroundingUrl, PrebuiltVoice } from '../types';
import { GEMINI_FLASH_MODEL, GEMINI_FLASH_IMAGE_MODEL, GEMINI_FLASH_TTS_MODEL } from '../constants';

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1]); 
    reader.onerror = (error) => reject(error);
    reader.readAsDataURL(file);
  });
}

function decodeBase64(base64: string): Uint8Array {
  const binary_string = window.atob(base64);
  const len = binary_string.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary_string.charCodeAt(i);
  }
  return bytes;
}

function writeString(view: DataView, offset: number, s: string) {
  for (let i = 0; i < s.length; i++) {
    view.setUint8(offset + i, s.charCodeAt(i));
  }
}

function createWavHeader(sampleRate: number, numChannels: number, pcmDataLength: number): Uint8Array {
  const headerLength = 44;
  const totalLength = pcmDataLength + headerLength;
  const buffer = new ArrayBuffer(headerLength);
  const view = new DataView(buffer);

  writeString(view, 0, 'RIFF'); 
  view.setUint32(4, totalLength - 8, true); 
  writeString(view, 8, 'WAVE'); 

  writeString(view, 12, 'fmt '); 
  view.setUint32(16, 16, true); 
  view.setUint16(20, 1, true); 
  view.setUint16(22, numChannels, true); 
  view.setUint32(24, sampleRate, true); 
  view.setUint32(28, sampleRate * numChannels * 2, true); 
  view.setUint16(32, numChannels * 2, true); 
  view.setUint16(34, 16, true); 

  writeString(view, 36, 'data'); 
  view.setUint32(40, pcmDataLength, true); 

  return new Uint8Array(buffer);
}

export const generateTextContent = async (
  prompt: string,
  useGoogleSearch: boolean = false,
  enableTTS: boolean = false,
  voiceName: PrebuiltVoice = PrebuiltVoice.ZEPHYR,
): Promise<{ text: string; groundingUrls?: GroundingUrl[]; audioUrl?: string; }> => {
  try {
    const config: any = {};
    if (useGoogleSearch) {
      config.tools = [{ googleSearch: {} }];
    }

    const response = await ai.models.generateContent({
      model: GEMINI_FLASH_MODEL,
      contents: prompt,
      config: config,
    });

    const text = response.text || 'No text generated.';
    
    let groundingUrls: GroundingUrl[] | undefined;
    const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
    if (groundingChunks && groundingChunks.length > 0) {
      groundingUrls = [];
      for (const chunk of groundingChunks) {
        if (chunk.web?.uri) {
          groundingUrls.push({ uri: chunk.web.uri, title: chunk.web.title });
        }
      }
    }

    let audioUrl: string | undefined;
    if (enableTTS && text) {
      try {
        const ttsResponse = await ai.models.generateContent({
          model: GEMINI_FLASH_TTS_MODEL,
          contents: [{ parts: [{ text: text }] }],
          config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName },
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

          const blob = new Blob([fullWavBytes], { type: 'audio/wav' });
          audioUrl = URL.createObjectURL(blob);
        }
      } catch (ttsError) {
        console.warn('TTS generation failed:', ttsError);
      }
    }

    return {
      text,
      groundingUrls,
      audioUrl,
    };
  } catch (error: any) {
    console.error('Error generating text content:', error);
    throw new Error(`Failed to generate content: ${error.message || 'Unknown error'}`);
  }
};

export const editImage = async (imageFile: File, prompt: string): Promise<string> => {
  try {
    const base64ImageData = await fileToBase64(imageFile);
    
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

export const generateImageFromText = async (prompt: string): Promise<string> => {
  try {
    const response = await ai.models.generateContent({
      model: GEMINI_FLASH_IMAGE_MODEL,
      contents: {
        parts: [{ text: prompt }],
      },
      config: {
        imageConfig: {
          aspectRatio: "9:16", // Vertical for Reels/Stories
        }
      }
    });

    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData?.data && part.inlineData.mimeType) {
        return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
      }
    }

    throw new Error('No image generated.');
  } catch (error: any) {
    console.error('Error generating image:', error);
    throw new Error(`Failed to generate image: ${error.message || 'Unknown error'}`);
  }
};