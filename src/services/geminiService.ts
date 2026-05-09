import { GoogleGenAI } from "@google/genai";
import { LyricLine } from "../types";

export async function detectAudioKey(base64Audio: string, mimeType: string, customApiKey?: string): Promise<string> {
  const apiKey = customApiKey || process.env.GEMINI_API_KEY || '';
  if (!apiKey) return "API Key missing";
  
  const ai = new GoogleGenAI({ apiKey });
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: {
        role: "user",
        parts: [
          { inlineData: { data: base64Audio, mimeType: mimeType } },
          { text: "Analiza este audio y dime exclusivamente la tonalidad musical (ej: 'C Major', 'A Minor'). Responde solo con el nombre de la tonalidad." },
        ],
      },
    });
    return response.text?.trim() || "Desconocido";
  } catch (error) {
    console.error("Error detecting key:", error);
    return "Error";
  }
}

export async function extractLyricsFromAudio(base64Audio: string, mimeType: string, customApiKey?: string): Promise<string> {
  const apiKey = customApiKey || process.env.GEMINI_API_KEY || '';
  if (!apiKey) return "API Key missing";

  const ai = new GoogleGenAI({ apiKey });
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: {
        role: "user",
        parts: [
          { inlineData: { data: base64Audio, mimeType: mimeType } },
          { text: "Transcripción de Audio Musical: Escucha este audio y extrae la letra completa. Formato OBLIGATORIO: Agrega marcas de tiempo exactas al inicio de cada frase usando el formato [MM:SS]. Ejemplo:\n[00:05] Primera línea de la canción\n[00:10] Segunda línea...\nNo agregues texto adicional, solo las líneas con tiempo." },
        ],
      },
    });
    return response.text || "";
  } catch (error) {
    console.error("Error extracting lyrics:", error);
    return "Error al procesar audio. Revisa tu API Key.";
  }
}

export async function parseLyricsIntoLines(rawText: string): Promise<LyricLine[]> {
  const lines: LyricLine[] = [];
  // Match formats like [00:12], [0:12], [12:34]
  const regex = /\[(\d{1,2}):(\d{2})\]\s*(.*)/g;
  let match;

  while ((match = regex.exec(rawText)) !== null) {
    const minutes = parseInt(match[1]);
    const seconds = parseInt(match[2]);
    const text = match[3].trim();
    
    if (text) {
      lines.push({
        id: crypto.randomUUID(),
        startTime: minutes * 60 + seconds,
        text: text,
      });
    }
  }

  // Si no hay tiempos, intentar separar por líneas y asignar tiempos ficticios
  if (lines.length === 0 && rawText.trim()) {
    const plainLines = rawText.split('\n').map(l => l.replace(/\[.*?\]/g, '').trim()).filter(l => l);
    plainLines.forEach((text, i) => {
      lines.push({
        id: crypto.randomUUID(),
        startTime: i * 4,
        text: text,
      });
    });
  }

  return lines.sort((a,b) => a.startTime - b.startTime);
}
