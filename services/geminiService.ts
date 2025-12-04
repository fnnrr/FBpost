import { GoogleGenAI, GenerateContentResponse, Modality } from '@google/genai';
import {
  GEMINI_FLASH_MODEL,
  GEMINI_FLASH_IMAGE_MODEL,
  GEMINI_FLASH_TTS_MODEL, // New import
} from '../constants';
import { GroundingUrl, PrebuiltVoice } from '../types';

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

// Helper to write string to DataView for WAV header
function writeString(view: DataView, offset: number, s: string) {
  for (let i = 0; i < s.length; i++) {
    view.setUint8(offset + i, s.charCodeAt(i));
  }
}

// Helper to create a WAV header for raw PCM audio
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

export const generateTextContent = async (
  prompt: string,
  useGoogleSearch: boolean = false,
  enableTTS: boolean = false,
  voiceName: PrebuiltVoice = PrebuiltVoice.ZEPHYR, // Default voice
): Promise<{ text: string; groundingUrls?: GroundingUrl[]; audioUrl?: string; }> => {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
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
      console.log(`Generating speech for text: "${textResponse.substring(0, 50)}..." with voice: ${voiceName}`);
      const ttsResponse: GenerateContentResponse = await ai.models.generateContent({
        model: GEMINI_FLASH_TTS_MODEL,
        contents: [{ parts: [{ text: textResponse }] }],
        config: {
          responseModalities: [Modality.AUDIO], // Must be an array with a single `Modality.AUDIO` element.
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: voiceName },
            },
          },
        },
      });

      const base64Audio = ttsResponse.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (base64Audio) {
        const rawPcmBytes = decodeBase64(base64Audio);
        const sampleRate = 24000; // As per Gemini TTS output
        const numChannels = 1; // As per Gemini TTS output
        const wavHeader = createWavHeader(sampleRate, numChannels, rawPcmBytes.length);

        // Concatenate header and PCM data
        const fullWavBytes = new Uint8Array(wavHeader.length + rawPcmBytes.length);
        fullWavBytes.set(wavHeader, 0);
        fullWavBytes.set(rawPcmBytes, wavHeader.length);

        // Encode the full WAV byte array to base64
        let binary = '';
        const len = fullWavBytes.byteLength;
        for (let i = 0; i < len; i++) {
          binary += String.fromCharCode(fullWavBytes[i]);
        }
        audioUrl = `data:audio/wav;base64,${btoa(binary)}`;
      } else {
        console.warn('No audio data received from TTS model.');
      }
    }

    return { text: textResponse || 'No text response received.', groundingUrls, audioUrl };
  } catch (error: any) {
    console.error('Error generating text content or speech:', error);
    throw new Error(`Failed to generate content: ${error.message || 'Unknown error'}`);
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