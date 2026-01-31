import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { ConnectionState, Message, ChatSession } from './types';
import { encodeBase64, decodeAudioData, decodeBase64 } from './utils/audioUtils';
import AudioVisualizer from './components/AudioVisualizer';
import ChatMessage from './components/ChatMessage';
import Sidebar from './components/Sidebar';

// --- Constants ---
const MODEL_NAME = 'gemini-2.5-flash-native-audio-preview-12-2025';
const SYSTEM_INSTRUCTION = `You are a highly skilled bilingual interpreter for English and Portuguese.

Your Goal: Provide accurate, natural, and real-time translation between the two languages.

Instructions:
1. Continuously listen to the audio stream.
2. AUTOMATICALLY DETECT the language spoken (English or Portuguese).
3. IF ENGLISH: Translate the speech immediately into natural Portuguese.
4. IF PORTUGUESE: Translate the speech immediately into natural English.
5. Do not summarize or respond to the user's statement. ONLY TRANSLATE.
6. Maintain the tone, emotion, and nuance of the original speaker.
7. If the speech is unclear, make the best possible guess based on context.
8. Do not hallucinate other languages. The input will be English or Portuguese.

Example:
Input: "Hello, how are you?" -> Output: "Olá, como vai você?"
Input: "Estou bem, obrigado." -> Output: "I am fine, thanks."
`;

const HEALTH_CHECK_INTERVAL_MS = 5000;
const HEALTH_TIMEOUT_MS = 15000;
const SILENCE_DURATION_MS = Number(process.env.SILENCE_DURATION_MS) || 500;

// Simple counter to guarantee unique message IDs even within the same millisecond
let messageIdCounter = 0;
function nextMessageId(suffix: string): string {
  return `${Date.now()}-${++messageIdCounter}-${suffix}`;
}

const createNewSessionObj = (): ChatSession => ({
  id: Date.now().toString(),
  title: 'New Conversation',
  createdAt: new Date(),
  messages: []
});

/** Update a partial transcription DOM element without triggering React re-renders */
function updatePartialEl(el: HTMLDivElement | null, text: string) {
  if (!el) return;
  const p = el.querySelector('p');
  if (p) p.textContent = text;
  if (text) {
    el.classList.remove('hidden');
  } else {
    el.classList.add('hidden');
  }
}

export default function App() {
  // --- State ---
  const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.DISCONNECTED);
  const [error, setError] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [sessions, setSessions] = useState<ChatSession[]>([createNewSessionObj()]);
  const [currentSessionId, setCurrentSessionId] = useState<string>(sessions[0].id);
  const [messages, setMessages] = useState<Message[]>([]);

  // Audio pipeline refs (persist across Gemini reconnects)
  const inputContextRef = useRef<AudioContext | null>(null);
  const outputContextRef = useRef<AudioContext | null>(null);
  const inputAnalyserRef = useRef<AnalyserNode | null>(null);
  const outputAnalyserRef = useRef<AnalyserNode | null>(null);
  const inputSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const outputGainRef = useRef<GainNode | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);

  const [inputAnalyser, setInputAnalyser] = useState<AnalyserNode | null>(null);
  const [outputAnalyser, setOutputAnalyser] = useState<AnalyserNode | null>(null);

  // Gemini session refs
  const sessionPromiseRef = useRef<Promise<any> | null>(null);
  const resolvedSessionRef = useRef<any>(null);
  const shouldBeConnectedRef = useRef<boolean>(false);
  const isSessionActiveRef = useRef<boolean>(false);
  const connectRef = useRef<() => Promise<void>>(null);
  const connectGeminiRef = useRef<() => Promise<void>>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);

  // Audio playback refs
  const nextStartTimeRef = useRef<number>(0);
  const audioSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

  // Partial transcription refs (DOM-based to avoid React re-renders)
  const currentInputTransRef = useRef<string>('');
  const currentOutputTransRef = useRef<string>('');
  const partialUserElRef = useRef<HTMLDivElement>(null);
  const partialModelElRef = useRef<HTMLDivElement>(null);

  // Health monitoring
  const lastGeminiResponseRef = useRef<number>(0);
  const healthCheckIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // Sync messages to sessions only when messages state changes
  // (partials update DOM directly and don't trigger this)
  useEffect(() => {
    setSessions(prev => prev.map(session => {
      if (session.id === currentSessionId) {
        let newTitle = session.title;
        if (session.title === 'New Conversation' && messages.length > 0) {
          const firstUserMsg = messages.find(m => m.role === 'user' && m.isFinal);
          if (firstUserMsg) {
            newTitle = firstUserMsg.text.slice(0, 30) + (firstUserMsg.text.length > 30 ? '...' : '');
          }
        }
        return { ...session, messages: messages, title: newTitle };
      }
      return session;
    }));
  }, [messages, currentSessionId]);

  const cleanupAudioPipeline = useCallback(async () => {
    audioSourcesRef.current.forEach(source => {
      try { source.stop(); } catch (e) {}
    });
    audioSourcesRef.current.clear();

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }

    try { inputSourceRef.current?.disconnect(); } catch(e) {}
    try { workletNodeRef.current?.disconnect(); } catch(e) {}
    try { outputGainRef.current?.disconnect(); } catch(e) {}

    if (inputContextRef.current && inputContextRef.current.state !== 'closed') {
      try { await inputContextRef.current.close(); } catch(e) {}
    }
    if (outputContextRef.current && outputContextRef.current.state !== 'closed') {
      try { await outputContextRef.current.close(); } catch(e) {}
    }

    inputContextRef.current = null;
    outputContextRef.current = null;
    inputSourceRef.current = null;
    workletNodeRef.current = null;
    outputGainRef.current = null;
    inputAnalyserRef.current = null;
    outputAnalyserRef.current = null;

    setInputAnalyser(null);
    setOutputAnalyser(null);
    nextStartTimeRef.current = 0;
  }, []);

  const cleanupGeminiSession = useCallback(() => {
    sessionPromiseRef.current = null;
    resolvedSessionRef.current = null;
    isSessionActiveRef.current = false;
    lastGeminiResponseRef.current = 0;

    if (healthCheckIntervalRef.current) {
      clearInterval(healthCheckIntervalRef.current);
      healthCheckIntervalRef.current = null;
    }
  }, []);

  /** Set up mic capture, AudioWorklet, and output graph. Called once per connect. */
  const setupAudioPipeline = useCallback(async () => {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    inputContextRef.current = new AudioContextClass();
    outputContextRef.current = new AudioContextClass({ sampleRate: 24000 });

    if (inputContextRef.current.state === 'suspended') {
      await inputContextRef.current.resume();
    }
    if (outputContextRef.current.state === 'suspended') {
      await outputContextRef.current.resume();
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        sampleRate: { ideal: 16000 },
        channelCount: 1,
      }
    });
    mediaStreamRef.current = stream;
    inputSourceRef.current = inputContextRef.current.createMediaStreamSource(stream);
    inputAnalyserRef.current = inputContextRef.current.createAnalyser();
    inputAnalyserRef.current.fftSize = 256;

    await inputContextRef.current.audioWorklet.addModule('/audio-processor.js');
    workletNodeRef.current = new AudioWorkletNode(inputContextRef.current, 'audio-capture-processor');

    inputSourceRef.current.connect(inputAnalyserRef.current);
    inputAnalyserRef.current.connect(workletNodeRef.current);
    workletNodeRef.current.connect(inputContextRef.current.destination);
    setInputAnalyser(inputAnalyserRef.current);

    outputAnalyserRef.current = outputContextRef.current.createAnalyser();
    outputAnalyserRef.current.fftSize = 256;
    outputGainRef.current = outputContextRef.current.createGain();
    outputGainRef.current.gain.value = 1.0;
    outputAnalyserRef.current.connect(outputGainRef.current);
    outputGainRef.current.connect(outputContextRef.current.destination);
    setOutputAnalyser(outputAnalyserRef.current);
  }, []);

  /** Connect (or reconnect) to Gemini and wire audio sending. */
  const connectGemini = useCallback(async () => {
    cleanupGeminiSession();
    setError(null);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const config = {
        model: MODEL_NAME,
        callbacks: {
          onopen: () => {
            console.log("Session Opened");
            setConnectionState(ConnectionState.CONNECTED);
            isSessionActiveRef.current = true;
          },
          onmessage: async (message: LiveServerMessage) => {
            lastGeminiResponseRef.current = Date.now();

            // --- Partial transcriptions (DOM-only, no React re-renders) ---
            if (message.serverContent?.inputTranscription) {
              const text = message.serverContent.inputTranscription.text;
              if (text) {
                currentInputTransRef.current += text;
                updatePartialEl(partialUserElRef.current, currentInputTransRef.current);
                scrollToBottom();
              }
            }

            if (message.serverContent?.outputTranscription) {
              const text = message.serverContent.outputTranscription.text;
              if (text) {
                currentOutputTransRef.current += text;
                updatePartialEl(partialModelElRef.current, currentOutputTransRef.current);
                scrollToBottom();
              }
            }

            // --- Turn complete: commit final messages to React state ---
            if (message.serverContent?.turnComplete) {
               if (currentInputTransRef.current) {
                 const finalText = currentInputTransRef.current;
                 setMessages(prev => [...prev, {
                   id: nextMessageId('user'),
                   role: 'user',
                   text: finalText,
                   timestamp: new Date(),
                   isFinal: true
                 }]);
                 currentInputTransRef.current = '';
                 updatePartialEl(partialUserElRef.current, '');
               }
               if (currentOutputTransRef.current) {
                  const finalText = currentOutputTransRef.current;
                  setMessages(prev => [...prev, {
                    id: nextMessageId('model'),
                    role: 'model',
                    text: finalText,
                    timestamp: new Date(),
                    isFinal: true
                  }]);
                  currentOutputTransRef.current = '';
                  updatePartialEl(partialModelElRef.current, '');
               }
            }

            // --- Audio playback ---
            const audioBase64 = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (audioBase64 && outputContextRef.current && outputAnalyserRef.current) {
              const ctx = outputContextRef.current;
              const bytes = decodeBase64(audioBase64);
              const buffer = await decodeAudioData(bytes, ctx, 24000, 1);
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
              const source = ctx.createBufferSource();
              source.buffer = buffer;
              source.connect(outputAnalyserRef.current);
              source.addEventListener('ended', () => { audioSourcesRef.current.delete(source); });
              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += buffer.duration;
              audioSourcesRef.current.add(source);
            }

            // --- Interruption ---
            if (message.serverContent?.interrupted) {
              audioSourcesRef.current.forEach(s => { try { s.stop(); } catch(e) {} });
              audioSourcesRef.current.clear();
              nextStartTimeRef.current = 0;
              currentOutputTransRef.current = '';
              updatePartialEl(partialModelElRef.current, '');
            }
          },
          onerror: (e: ErrorEvent) => {
            console.error("Session Error", e);
          },
          onclose: (e: CloseEvent) => {
            console.log("Session Closed", e);
            isSessionActiveRef.current = false;
            resolvedSessionRef.current = null;
            if (shouldBeConnectedRef.current) {
              setConnectionState(ConnectionState.CONNECTING);
              reconnectTimeoutRef.current = window.setTimeout(() => {
                if (!shouldBeConnectedRef.current) return;
                // If audio pipeline is still alive, only reconnect Gemini (fast path)
                if (inputContextRef.current && inputContextRef.current.state !== 'closed') {
                  connectGeminiRef.current?.();
                } else {
                  connectRef.current?.();
                }
              }, 2000);
            } else {
              setConnectionState(ConnectionState.DISCONNECTED);
            }
          }
        },
        config: {
           responseModalities: [Modality.AUDIO],
           systemInstruction: SYSTEM_INSTRUCTION,
           speechConfig: {
             voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } }
           },
           inputAudioTranscription: {},
           outputAudioTranscription: {},
           realtimeInputConfig: {
             automaticActivityDetection: {
               silenceDurationMs: SILENCE_DURATION_MS,
             }
           },
           contextWindowCompression: {
             triggerTokens: 10240,
             slidingWindow: { targetTokens: 5120 }
           }
        }
      };

      sessionPromiseRef.current = ai.live.connect(config);
      const session = await sessionPromiseRef.current;
      resolvedSessionRef.current = session;

      // Wire worklet audio output to Gemini session.
      // The worklet posts ready-to-encode Int16 PCM data.
      if (workletNodeRef.current) {
        workletNodeRef.current.port.onmessage = (event) => {
          if (!shouldBeConnectedRef.current || !isSessionActiveRef.current) return;

          const pcmData: Uint8Array = event.data.pcmData;
          const base64Data = encodeBase64(pcmData);

          const session = resolvedSessionRef.current;
          if (session && typeof session.sendRealtimeInput === 'function') {
            try {
              const p = session.sendRealtimeInput({
                media: { data: base64Data, mimeType: "audio/pcm;rate=16000" }
              });
              if (p && typeof p.catch === 'function') {
                p.catch((err: any) => console.warn("Realtime send failed:", err));
              }
            } catch (sendErr) {
              console.warn("Immediate send failed:", sendErr);
            }
          }
        };
      }

      // Start connection health monitoring
      healthCheckIntervalRef.current = setInterval(() => {
        if (!isSessionActiveRef.current || !shouldBeConnectedRef.current) return;
        const elapsed = Date.now() - lastGeminiResponseRef.current;
        if (lastGeminiResponseRef.current > 0 && elapsed > HEALTH_TIMEOUT_MS) {
          console.warn(`No Gemini response for ${HEALTH_TIMEOUT_MS / 1000}s, reconnecting...`);
          lastGeminiResponseRef.current = 0;
          // Trigger reconnect via the Gemini-only path
          isSessionActiveRef.current = false;
          if (inputContextRef.current && inputContextRef.current.state !== 'closed') {
            connectGeminiRef.current?.();
          } else {
            connectRef.current?.();
          }
        }
      }, HEALTH_CHECK_INTERVAL_MS);

    } catch (err: any) {
      console.error("Gemini connection error:", err);
      setError(err.message || "Failed to connect to Gemini.");
      setConnectionState(ConnectionState.ERROR);
      isSessionActiveRef.current = false;
    }
  }, [cleanupGeminiSession, scrollToBottom]);

  /** Full connect: set up audio pipeline then connect Gemini. */
  const connect = useCallback(async () => {
    if (reconnectTimeoutRef.current) {
      window.clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    setError(null);
    setConnectionState(ConnectionState.CONNECTING);
    shouldBeConnectedRef.current = true;

    try {
      await setupAudioPipeline();
      await connectGemini();
    } catch (err: any) {
      console.error("Connection flow error:", err);
      setError(err.message || "Failed to connect. Check permissions and network.");
      setConnectionState(ConnectionState.ERROR);
      cleanupGeminiSession();
      await cleanupAudioPipeline();
      shouldBeConnectedRef.current = false;
      isSessionActiveRef.current = false;
    }
  }, [setupAudioPipeline, connectGemini, cleanupGeminiSession, cleanupAudioPipeline]);

  const disconnect = useCallback(async () => {
    shouldBeConnectedRef.current = false;
    setConnectionState(ConnectionState.DISCONNECTED);

    if (reconnectTimeoutRef.current) {
      window.clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    cleanupGeminiSession();
    await cleanupAudioPipeline();

    // Clear any partial transcription DOM state
    currentInputTransRef.current = '';
    currentOutputTransRef.current = '';
    updatePartialEl(partialUserElRef.current, '');
    updatePartialEl(partialModelElRef.current, '');
  }, [cleanupGeminiSession, cleanupAudioPipeline]);

  // Keep stable refs for the onclose handler
  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  useEffect(() => {
    connectGeminiRef.current = connectGemini;
  }, [connectGemini]);

  const handleToggleConnection = () => {
    if (connectionState === ConnectionState.CONNECTED || connectionState === ConnectionState.CONNECTING) {
      disconnect();
    } else {
      connect();
    }
  };

  const handleSwitchSession = (sessionId: string) => {
    if (connectionState === ConnectionState.CONNECTED) disconnect();
    const targetSession = sessions.find(s => s.id === sessionId);
    if (targetSession) {
      setCurrentSessionId(sessionId);
      setMessages(targetSession.messages);
    }
  };

  const handleNewChat = () => {
    if (connectionState === ConnectionState.CONNECTED) disconnect();
    const newSession = createNewSessionObj();
    setSessions(prev => [...prev, newSession]);
    setCurrentSessionId(newSession.id);
    setMessages([]);
  };

  return (
    <div className="flex h-screen bg-slate-900 text-slate-100 overflow-hidden">
      <Sidebar
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        sessions={sessions}
        currentSessionId={currentSessionId}
        onSelectSession={handleSwitchSession}
        onNewChat={handleNewChat}
      />
      <div className="flex-1 flex flex-col min-w-0 relative">
        <header className="flex-none h-16 px-4 bg-slate-800/50 backdrop-blur-md border-b border-slate-700 flex items-center justify-between z-10">
          <div className="flex items-center gap-3">
            <button onClick={() => setIsSidebarOpen(true)} className="md:hidden p-2 -ml-2 text-slate-400 hover:text-white">
               <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" /></svg>
            </button>
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-teal-400 flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5 text-white"><path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" /></svg>
            </div>
            <h1 className="text-lg md:text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-300 to-teal-200">DuoVoice Live</h1>
          </div>
          <div className={`px-3 py-1 rounded-full text-xs font-semibold flex items-center gap-2
            ${connectionState === ConnectionState.CONNECTED ? 'bg-teal-500/20 text-teal-300 border border-teal-500/30' :
              connectionState === ConnectionState.CONNECTING ? 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/30' :
              'bg-slate-700 text-slate-400 border border-slate-600'}`}>
            <span className={`w-2 h-2 rounded-full ${connectionState === ConnectionState.CONNECTED ? 'bg-teal-400 animate-pulse' : connectionState === ConnectionState.CONNECTING ? 'bg-yellow-400 animate-bounce' : 'bg-slate-500'}`}></span>
            {connectionState === ConnectionState.CONNECTED ? 'LIVE' : connectionState === ConnectionState.CONNECTING ? 'CONNECTING' : 'OFFLINE'}
          </div>
        </header>
        <main className="flex-1 flex flex-col relative overflow-hidden">
          <div className="flex-none h-40 md:h-56 bg-gradient-to-b from-slate-900 to-slate-800 relative">
            <div className="absolute inset-0 opacity-80 mix-blend-screen"><AudioVisualizer analyser={inputAnalyser} isActive={connectionState === ConnectionState.CONNECTED} color="#f472b6" /></div>
            <div className="absolute inset-0 opacity-80 mix-blend-screen"><AudioVisualizer analyser={outputAnalyser} isActive={connectionState === ConnectionState.CONNECTED} color="#2dd4bf" /></div>
            <div className="absolute bottom-4 left-0 right-0 text-center">
               {connectionState === ConnectionState.CONNECTED && <p className="text-sm text-slate-400 animate-pulse">Listening...</p>}
               {connectionState === ConnectionState.CONNECTING && <p className="text-sm text-yellow-400">Reconnecting...</p>}
            </div>
          </div>
          <div className="flex-1 bg-slate-900 relative overflow-hidden flex flex-col">
            <div className="flex-1 overflow-y-auto p-4 pb-32 scroll-smooth" ref={scrollRef}>
              {messages.length === 0 && !currentInputTransRef.current && !currentOutputTransRef.current ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-500 opacity-60">
                   <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-16 h-16 mb-4"><path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" /></svg>
                   <p className="text-center px-4">Tap the microphone to start translating.<br/>New chats can be started from the sidebar.</p>
                </div>
              ) : (
                <>
                  {messages.map((msg) => <ChatMessage key={msg.id} message={msg} />)}
                  {/* Partial transcriptions updated via DOM refs — no React re-renders */}
                  <div ref={partialUserElRef} className="flex w-full mb-4 justify-end hidden">
                    <div className="max-w-[80%] px-4 py-3 rounded-2xl shadow-md text-sm md:text-base leading-relaxed bg-blue-600 text-white rounded-tr-none opacity-70 animate-pulse">
                      <p></p>
                    </div>
                  </div>
                  <div ref={partialModelElRef} className="flex w-full mb-4 justify-start hidden">
                    <div className="max-w-[80%] px-4 py-3 rounded-2xl shadow-md text-sm md:text-base leading-relaxed bg-slate-700 text-slate-100 rounded-tl-none opacity-70 animate-pulse">
                      <p></p>
                    </div>
                  </div>
                </>
              )}
              {error && <div className="bg-red-500/10 border border-red-500/50 text-red-200 p-4 rounded-lg m-4 text-center text-sm">{error}</div>}
            </div>
          </div>
          <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-20 flex items-center gap-6">
            <button onClick={handleToggleConnection}
              className={`w-16 h-16 rounded-full flex items-center justify-center transition-all duration-300 shadow-2xl hover:scale-105 active:scale-95
                ${connectionState === ConnectionState.CONNECTED ? 'bg-red-500 hover:bg-red-600 shadow-red-500/40' :
                  connectionState === ConnectionState.CONNECTING ? 'bg-yellow-500 shadow-yellow-500/40 animate-pulse' :
                  'bg-teal-500 hover:bg-teal-600 shadow-teal-500/40 animate-pulse-slow'}`}
            >
              {connectionState === ConnectionState.CONNECTED ? (
                 <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-8 h-8"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              ) : (
                 <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-8 h-8"><path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" /></svg>
              )}
            </button>
          </div>
        </main>
      </div>
    </div>
  );
}
