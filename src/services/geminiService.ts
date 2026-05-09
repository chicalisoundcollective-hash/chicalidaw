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
          { text: "Analiza este audio musical y detecta la tonalidad exacta (ej: 'C Major', 'F# Minor'). Responde únicamente con el nombre de la tonalidad." },
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
          { text: "Transcripción Musical Profesional y Ultra-Detallada:\nEscucha este audio y extrae la letra EXACTA palabra por palabra.\n\nINSTRUCCIONES DE PRECISIÓN:\n1. NO RESUMAS NADA. Si el artista repite una palabra (ej. 'miente, miente, miente'), escríbela exactamente las veces que suena.\n2. CAPTURA VOCALIZACIONES: Incluye 'no no no', 'uuh', 'yeah', 'ay', etc., especialmente en las intros y puentes.\n3. MARCAS DE TIEMPO: Inserta [MM:SS] al inicio de cada frase de forma sincronizada.\n4. FIDELIDAD: Si el cantante arrastra una palabra o dice algo fonéticamente distinto, prioriza lo que se escucha sobre la letra oficial.\n\nFormato:\n[00:00] (Intro vocal)\n[00:05] Frase exacta...\n\nResponde solo con la letra sincronizada." },
        ],
      },
    });
    return response.text || "";
  } catch (error) {
    console.error("Error extracting lyrics:", error);
    return "Error en transcripción. Verifica tu API Key.";
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
