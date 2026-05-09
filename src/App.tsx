import React, { useState, useRef, useEffect } from 'react';
import { 
  Play, 
  Pause, 
  RotateCcw, 
  Settings2, 
  Music2, 
  Mic2,
  ChevronUp,
  ChevronDown,
  Clock,
  LayoutGrid,
  Upload,
  FileAudio,
  Download,
  Key
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import * as Tone from 'tone';
import { parseLyricsIntoLines, extractLyricsFromAudio, detectAudioKey } from './services/geminiService';
import { LyricLine, TeleprompterSettings } from './types.ts';

export default function App() {
  const [lyrics, setLyrics] = useState<LyricLine[]>([]);
  const [rawText, setRawText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [viewMode, setViewMode] = useState<'editor' | 'prompter' | 'settings'>('editor');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [backingTrackUrl, setBackingTrackUrl] = useState<string | null>(null);
  const [recordedVocalUrl, setRecordedVocalUrl] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [pitch, setPitch] = useState(0);
  const [detectedKey, setDetectedKey] = useState<string | null>(null);
  const [activeLineIndex, setActiveLineIndex] = useState(-1);
  const [apiKey, setApiKey] = useState(process.env.GEMINI_API_KEY || '');
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const playerRef = useRef<Tone.Player | null>(null);
  const pitchShiftRef = useRef<Tone.PitchShift | null>(null);
  const transportUpdateRef = useRef<number | null>(null);

  const [settings, setSettings] = useState<TeleprompterSettings>({
    bpm: 120,
    fontSize: 48,
    lineHeight: 1.5,
    scrollSpeed: 2,
    isAutoScroll: true,
    highlightActive: true,
  });

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (pitchShiftRef.current) {
      pitchShiftRef.current.pitch = pitch;
    }
  }, [pitch]);

  // Sync Transport with Player
  const setupTransportSync = () => {
    Tone.Transport.cancel();
    Tone.Transport.stop();
    Tone.Transport.seconds = 0;
    
    if (playerRef.current) {
      playerRef.current.sync().start(0);
    }
  };

  const startRecording = async () => {
    try {
      await Tone.start();
      console.log("Audio Context Started");
      
      if (!playerRef.current) {
        alert("Please upload a backing track first.");
        return;
      }

      setupTransportSync();
      setRecordedVocalUrl(null);

      // Request Mic Access
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        } 
      });

      if (stream) {
        const mediaRecorder = new MediaRecorder(stream);
        mediaRecorderRef.current = mediaRecorder;
        audioChunksRef.current = [];
        
        mediaRecorder.ondataavailable = (e) => {
          if (e.data.size > 0) audioChunksRef.current.push(e.data);
        };

        mediaRecorder.onstop = () => {
          const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
          const url = URL.createObjectURL(blob);
          setRecordedVocalUrl(url);
          stream.getTracks().forEach(track => track.stop());
        };

        // Precision Start
        mediaRecorder.start();
        Tone.Transport.start();
        setIsPlaying(true);
        setIsRecording(true);
      }
    } catch (err) {
      console.error("Recording initialization failed:", err);
      alert("Mic permission denied or audio issue.");
    }
  };

  const stopRecording = () => {
    Tone.Transport.stop();
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
    setIsPlaying(false);
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    
    setSelectedFile(file);
    const audioUrl = URL.createObjectURL(file);
    setBackingTrackUrl(audioUrl);
    setIsLoading(true);

    try {
      if (playerRef.current) playerRef.current.dispose();
      if (pitchShiftRef.current) pitchShiftRef.current.dispose();

      const pitchShift = new Tone.PitchShift(pitch).toDestination();
      const player = new Tone.Player({
        url: audioUrl,
        onload: () => {
          setDuration(player.buffer.duration);
          setupTransportSync();
        }
      }).connect(pitchShift);
      
      playerRef.current = player;
      pitchShiftRef.current = pitchShift;

      const reader = new FileReader();
      reader.onload = async (e) => {
        const base64 = e.target?.result as string;
        const base64Data = base64.split(',')[1];
        
        // Pass the API key if customized
        const [lyricsResult, keyResult] = await Promise.all([
          extractLyricsFromAudio(base64Data, file.type, apiKey),
          detectAudioKey(base64Data, file.type, apiKey)
        ]);

        setRawText(lyricsResult);
        setDetectedKey(keyResult);
        const lines = await parseLyricsIntoLines(lyricsResult);
        setLyrics(lines);
        setIsLoading(false);
        setViewMode('prompter');
      };
      reader.readAsDataURL(file);
    } catch (error) {
      console.error("Upload error:", error);
      setIsLoading(false);
    }
  };

  const handleRawTextChange = (text: string) => {
    setRawText(text);
    parseLyricsIntoLines(text).then(lines => setLyrics(lines));
  };

  const togglePlayback = () => {
    if (isRecording || isPlaying) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  const resetSession = () => {
    stopRecording();
    Tone.Transport.seconds = 0;
    setCurrentTime(0);
    setActiveLineIndex(-1);
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }
  };

  // Ultra-precise Teleprompter Clock
  useEffect(() => {
    const updateLoop = () => {
      const transportTime = Tone.Transport.seconds;
      setCurrentTime(transportTime);

      if (lyrics.length > 0) {
        let foundIndex = -1;
        for (let i = lyrics.length - 1; i >= 0; i--) {
          if (transportTime >= lyrics[i].startTime) {
            foundIndex = i;
            break;
          }
        }
        
        if (foundIndex !== activeLineIndex) {
          setActiveLineIndex(foundIndex);
        }
      }
      transportUpdateRef.current = requestAnimationFrame(updateLoop);
    };

    transportUpdateRef.current = requestAnimationFrame(updateLoop);
    return () => {
      if (transportUpdateRef.current) cancelAnimationFrame(transportUpdateRef.current);
    };
  }, [lyrics, activeLineIndex]);

  // Auto-Scroll Logic
  useEffect(() => {
    if (activeLineIndex !== -1 && scrollContainerRef.current) {
      const container = scrollContainerRef.current;
      const lineElements = container.querySelectorAll('.lyric-line');
      const activeElement = lineElements[activeLineIndex] as HTMLElement;
      
      if (activeElement) {
        activeElement.scrollIntoView({
          behavior: 'smooth',
          block: 'center'
        });
      }
    }
  }, [activeLineIndex]);

  const exportToSyncedText = () => {
    if (lyrics.length === 0) return;
    const formatTime = (s: number) => `[${Math.floor(s/60).toString().padStart(2,'0')}:${Math.floor(s%60).toString().padStart(2,'0')}]`;
    const content = lyrics.map(l => `${formatTime(l.startTime)} ${l.text}`).join('\n');
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `take_lyrics_${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex h-screen bg-[#050505] text-white font-sans overflow-hidden select-none">
      {/* DAW SIDEBAR */}
      <aside className="w-80 flex-shrink-0 border-r border-[#1F1F23] bg-[#0A0A0B] p-6 flex flex-col gap-6 z-30">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-[#F27D26] flex items-center justify-center shadow-[0_0_20px_rgba(242,125,38,0.2)]">
            <Mic2 className="text-white" size={24} />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tighter uppercase leading-none">Chicali DAW</h1>
            <p className="text-[10px] font-mono text-[#F27D26] uppercase tracking-widest mt-1">PRO STATION V2</p>
          </div>
        </div>

        {/* NAVIGATION TABS */}
        <div className="flex p-1 bg-[#151519] rounded-lg border border-[#1F1F23]">
          {['editor', 'prompter', 'settings'].map((mode) => (
            <button 
              key={mode}
              onClick={() => setViewMode(mode as any)}
              className={`flex-1 py-1.5 text-[10px] font-bold rounded-md transition-all uppercase tracking-widest ${viewMode === mode ? 'bg-[#F27D26] text-white shadow-lg' : 'text-[#8E9299] hover:text-white'}`}
            >
              {mode}
            </button>
          ))}
        </div>

        {/* CONTROLS SCROLL AREA */}
        <div className="flex-1 flex flex-col gap-6 overflow-y-auto pr-2 custom-scrollbar">
          
          {/* TRACK LOADING */}
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-[10px] font-mono text-[#8E9299] uppercase tracking-[0.2em] flex items-center gap-2">
                <Music2 size={12} /> BACKING TRACK
              </label>
              <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept="audio/*" className="hidden" />
              <button 
                onClick={() => fileInputRef.current?.click()}
                disabled={isLoading}
                className="w-full bg-[#151519] hover:bg-[#1F1F23] border border-[#1F1F23] rounded-xl px-4 py-6 flex flex-col items-center justify-center gap-3 transition-all group"
              >
                <div className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${selectedFile ? 'bg-[#F27D26]/20' : 'bg-black'}`}>
                  <Upload size={20} className={selectedFile ? 'text-[#F27D26]' : 'text-[#3A3A40]'} />
                </div>
                <div className="text-center">
                  <p className="text-[11px] font-bold text-white truncate max-w-[200px]">
                    {selectedFile ? selectedFile.name.toUpperCase() : 'SELECT AUDIO FILE'}
                  </p>
                  <p className="text-[9px] text-[#8E9299] mt-1 font-mono">CODECS: MP3/WAV/FLAC</p>
                </div>
              </button>
            </div>

            {isLoading && (
              <div className="p-4 bg-[#F27D26]/5 border border-[#F27D26]/20 rounded-xl space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-[9px] font-bold text-[#F27D26] animate-pulse">ANALYZING WAVEFORM...</span>
                </div>
                <div className="h-1 bg-black rounded-full overflow-hidden">
                  <motion.div initial={{ width: 0 }} animate={{ width: '100%' }} transition={{ duration: 15 }} className="bg-[#F27D26] h-full shadow-[0_0_10px_#F27D26]" />
                </div>
              </div>
            )}
          </div>

          <div className="h-px bg-[#1F1F23]" />

          {/* PERFORMANCE TOOLS */}
          <div className="space-y-6">
            {/* PITCH */}
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <label className="text-[10px] font-mono text-[#8E9299] uppercase tracking-widest">PITCH SHIFT</label>
                <span className="text-[10px] font-mono text-[#F27D26]">{detectedKey || 'AUTO'}</span>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setPitch(p => p - 1)} className="flex-1 py-4 rounded-lg bg-[#151519] border border-[#1F1F23] hover:bg-[#1F1F23] transition-colors"><ChevronDown size={14} className="mx-auto" /></button>
                <div className="w-16 text-center">
                  <span className="text-xl font-bold font-mono">{pitch > 0 ? `+${pitch}` : pitch}</span>
                  <p className="text-[8px] text-[#8E9299] uppercase">ST</p>
                </div>
                <button onClick={() => setPitch(p => p + 1)} className="flex-1 py-4 rounded-lg bg-[#151519] border border-[#1F1F23] hover:bg-[#1F1F23] transition-colors"><ChevronUp size={14} className="mx-auto" /></button>
              </div>
            </div>

            {/* SYNC & FONT */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-[9px] font-mono text-[#8E9299] uppercase">FONT SIZE</label>
                <div className="bg-[#151519] border border-[#1F1F23] p-2 rounded-lg flex items-center gap-2">
                  <input type="range" min="20" max="100" value={settings.fontSize} onChange={e => setSettings({...settings, fontSize: parseInt(e.target.value)})} className="flex-1 accent-[#F27D26] h-1" />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-[9px] font-mono text-[#8E9299] uppercase">BPM SYNC</label>
                <input type="number" value={settings.bpm} onChange={e => setSettings({...settings, bpm: parseInt(e.target.value) || 120})} className="w-full bg-[#151519] border border-[#1F1F23] rounded-lg p-2 text-xs font-mono text-center outline-none" />
              </div>
            </div>
          </div>

          {/* TAKE READY */}
          <AnimatePresence>
            {recordedVocalUrl && (
              <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="mt-4 p-5 bg-[#F27D26] rounded-2xl shadow-[0_10px_30px_rgba(242,125,38,0.3)]">
                <p className="text-[10px] font-black uppercase text-black mb-3 text-center tracking-[0.2em]">VOCAL TAKE ISOLATED</p>
                <a 
                  href={recordedVocalUrl} 
                  download="vocal_track_chicali.webm"
                  className="w-full py-3 bg-white text-black rounded-xl font-black text-xs flex items-center justify-center gap-2 hover:bg-black hover:text-white transition-all uppercase"
                >
                  <Download size={14} /> DOWNLOAD TAKE
                </a>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* BOTTOM MASTER BAR */}
        <div className="pt-6 border-t border-[#1F1F23]">
          <div className="flex justify-between items-center mb-4 px-1">
            <div className="flex items-center gap-2">
              <div className={`w-3 h-3 rounded-full ${isRecording ? 'bg-red-500 animate-pulse shadow-[0_0_10px_red]' : 'bg-[#1F1F23]'}`} />
              <span className="text-[10px] font-mono text-white/50 tracking-widest">{isRecording ? 'RECORDING' : 'READY'}</span>
            </div>
            <div className="text-xs font-mono font-bold tracking-tighter">
              {new Date(currentTime * 1000).toISOString().substr(14, 5)} <span className="opacity-30">/ {new Date(duration * 1000).toISOString().substr(14, 5)}</span>
            </div>
          </div>
          
          <div className="flex gap-2">
            <button onClick={resetSession} className="w-12 h-12 rounded-xl bg-[#151519] border border-[#1F1F23] flex items-center justify-center hover:bg-[#1F1F23] transition-all"><RotateCcw size={18} /></button>
            <button 
              onClick={togglePlayback}
              disabled={!selectedFile}
              className={`flex-1 h-12 rounded-xl flex items-center justify-center gap-3 font-black text-xs tracking-[0.2em] transition-all ${isRecording ? 'bg-red-600 shadow-[0_0_20px_rgba(220,38,38,0.4)]' : 'bg-[#F27D26] hover:scale-[1.02] active:scale-[0.98] disabled:opacity-30 disabled:grayscale'}`}
            >
              {isRecording ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
              {isRecording ? 'STOP TAKE' : 'REC VOCALS'}
            </button>
          </div>
        </div>
      </aside>

      {/* MAIN VIEW AREA */}
      <main className="flex-1 flex flex-col relative bg-[#050505] overflow-hidden">
        {/* TOP STATUS BAR */}
        <header className="h-16 border-b border-[#1F1F23] bg-[#0A0A0B] px-8 flex items-center justify-between z-20">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-3">
              <div className="w-2 h-2 rounded-full bg-[#F27D26]" />
              <div className="flex flex-col">
                <span className="text-[10px] font-black text-[#F27D26] uppercase tracking-widest leading-none">Vocal Session</span>
                <span className="text-[11px] text-[#8E9299] font-mono mt-1">{selectedFile?.name || 'WAITING FOR SOURCE...'}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={exportToSyncedText} className="px-4 py-1.5 rounded-full border border-[#1F1F23] text-[9px] font-bold text-[#8E9299] hover:text-white uppercase transition-all">Exportar SRT/Sincro</button>
            <div className="h-4 w-px bg-[#1F1F23]" />
            <Settings2 size={18} className="text-[#3A3A40] hover:text-white cursor-pointer" />
          </div>
        </header>

        {/* CONTENT SWITCHER */}
        <div className="flex-1 relative overflow-hidden">
          <AnimatePresence mode="wait">
            {viewMode === 'editor' && (
              <motion.div key="editor" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="h-full p-8 flex flex-col gap-6">
                <div className="flex justify-between items-end">
                  <div>
                    <h2 className="text-3xl font-black uppercase tracking-tighter">Editor</h2>
                    <p className="text-xs text-[#8E9299] font-mono mt-1">PEGA TU LETRA O USA EL AUTO-SYNC DE GEMINI</p>
                  </div>
                </div>
                <textarea 
                  className="flex-1 bg-[#0A0A0B] border border-[#1F1F23] rounded-3xl p-10 text-xl font-medium focus:outline-none focus:border-[#F27D26] resize-none leading-relaxed custom-scrollbar transition-all selection:bg-[#F27D26] selection:text-white"
                  placeholder="[00:00] Intro...
[00:15] Verso 1..."
                  value={rawText}
                  onChange={e => handleRawTextChange(e.target.value)}
                />
              </motion.div>
            )}

            {viewMode === 'prompter' && (
              <motion.div key="prompter" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-full relative overflow-hidden">
                {/* CENTER GUIDE */}
                <div className="absolute top-1/2 left-0 w-full h-[1px] bg-[#F27D26] opacity-30 z-10" />
                <div className="absolute top-1/2 -left-2 z-20 pointer-events-none transform -translate-y-1/2">
                   <div className="w-0 h-0 border-t-[10px] border-t-transparent border-b-[10px] border-b-transparent border-l-[15px] border-l-[#F27D26] shadow-[0_0_20px_#F27D26]" />
                </div>

                <div 
                  ref={scrollContainerRef}
                  className="h-full overflow-y-auto pt-[45vh] pb-[60vh] hide-scrollbar px-12 md:px-32 relative"
                >
                  {lyrics.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center gap-6 opacity-20">
                      <Music2 size={80} />
                      <p className="text-xl font-black uppercase tracking-widest">Sin Letra Cargada</p>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-12 text-center">
                      {lyrics.map((line, index) => {
                        const isActive = index === activeLineIndex;
                        return (
                          <motion.div 
                            key={line.id}
                            initial={{ opacity: 0.1, y: 20 }}
                            animate={{ 
                              opacity: isActive ? 1 : 0.05, 
                              scale: isActive ? 1.4 : 0.9,
                              color: isActive ? "#F27D26" : "#FFFFFF"
                            }}
                            className="lyric-line relative"
                          >
                            <p 
                              className="font-black tracking-tighter leading-none transition-all"
                              style={{ fontSize: `${settings.fontSize}px` }}
                            >
                              {line.text.toUpperCase()}
                            </p>
                            {isActive && (
                              <motion.div layoutId="line-glow" className="absolute -inset-x-10 -inset-y-4 bg-[#F27D26]/5 rounded-3xl blur-2xl -z-10" />
                            )}
                          </motion.div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* GRADIENTS */}
                <div className="absolute top-0 w-full h-48 bg-gradient-to-b from-[#050505] to-transparent z-20 pointer-events-none" />
                <div className="absolute bottom-0 w-full h-48 bg-gradient-to-t from-[#050505] to-transparent z-20 pointer-events-none" />
              </motion.div>
            )}

            {viewMode === 'settings' && (
              <motion.div key="settings" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="h-full p-12 max-w-2xl mx-auto space-y-12">
                <div className="space-y-4">
                  <h2 className="text-4xl font-black uppercase tracking-tighter">Configuraciones</h2>
                  <p className="text-sm text-[#8E9299] font-mono">APP TUNING & API KEYS</p>
                </div>

                <div className="space-y-8">
                  <div className="p-8 bg-[#0A0A0B] border border-[#1F1F23] rounded-3xl space-y-6">
                    <div className="flex items-center gap-4 text-[#F27D26]">
                      <Key size={24} />
                      <h3 className="text-sm font-bold uppercase tracking-widest">Gemini AI Key</h3>
                    </div>
                    <div className="space-y-4">
                      <p className="text-xs text-[#8E9299]">Esta llave permite que la IA escuche tus audios y escriba la letra automáticamente.</p>
                      <input 
                        type="password" 
                        value={apiKey}
                        onChange={e => setApiKey(e.target.value)}
                        placeholder="Introduce tu API Key..."
                        className="w-full bg-black border border-[#1F1F23] rounded-xl p-4 text-xs font-mono focus:border-[#F27D26] outline-none transition-all"
                      />
                      <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${apiKey ? 'bg-green-500' : 'bg-red-500'}`} />
                        <span className="text-[10px] uppercase font-bold text-[#3A3A40]">{apiKey ? 'API KEY CONFIGURADA' : 'SIN API KEY'}</span>
                      </div>
                    </div>
                  </div>

                  <div className="p-8 bg-[#0A0A0B] border border-[#1F1F23] rounded-3xl space-y-6">
                    <div className="flex items-center gap-4 text-blue-500">
                      <Settings2 size={24} />
                      <h3 className="text-sm font-bold uppercase tracking-widest">Preferencia de Grabación</h3>
                    </div>
                    <div className="space-y-4">
                      <div className="flex items-center justify-between p-4 bg-black/50 rounded-xl border border-[#1F1F23]">
                        <div>
                          <p className="text-xs font-bold">Auto-Scroll Inteligente</p>
                          <p className="text-[10px] text-[#3A3A40]">Mueve la letra según el tiempo del audio</p>
                        </div>
                        <div onClick={() => setSettings({...settings, isAutoScroll: !settings.isAutoScroll})} className={`w-12 h-6 rounded-full transition-all relative cursor-pointer ${settings.isAutoScroll ? 'bg-[#F27D26]' : 'bg-[#1F1F23]'}`}>
                          <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${settings.isAutoScroll ? 'left-7' : 'left-1'}`} />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #1F1F23; border-radius: 10px; }
        .hide-scrollbar::-webkit-scrollbar { display: none; }
        .hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
        input[type="range"] { -webkit-appearance: none; background: transparent; }
        input[type="range"]::-webkit-slider-thumb { -webkit-appearance: none; height: 16px; width: 16px; border-radius: 50%; background: #F27D26; cursor: pointer; margin-top: -6px; border: 2px solid white; }
        input[type="range"]::-webkit-slider-runnable-track { width: 100%; height: 4px; background: #1F1F23; border-radius: 2px; }
      `}</style>
    </div>
  );
}
