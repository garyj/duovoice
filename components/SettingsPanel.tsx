import React, { useCallback, useEffect, useState } from 'react';
import {
  clearGeminiKey,
  clearOpenAiKey,
  getGeminiKey,
  getOpenAiKey,
  isStorageAvailable,
  setGeminiKey,
  setOpenAiKey,
} from '../utils/keyStore';

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

const SettingsPanel: React.FC<SettingsPanelProps> = ({ isOpen, onClose }) => {
  const [geminiInput, setGeminiInput] = useState('');
  const [openAiInput, setOpenAiInput] = useState('');
  const [storedGemini, setStoredGemini] = useState<string | null>(null);
  const [storedOpenAi, setStoredOpenAi] = useState<string | null>(null);
  const [storageOk, setStorageOk] = useState(true);
  const [showGemini, setShowGemini] = useState(false);
  const [showOpenAi, setShowOpenAi] = useState(false);

  const refresh = useCallback(() => {
    const available = isStorageAvailable();
    setStorageOk(available);
    const geminiKey = getGeminiKey();
    const openAiKey = getOpenAiKey();
    setStoredGemini(geminiKey);
    setStoredOpenAi(openAiKey);
    setGeminiInput(geminiKey || '');
    setOpenAiInput(openAiKey || '');
  }, []);

  useEffect(() => {
    if (isOpen) refresh();
  }, [isOpen, refresh]);

  if (!isOpen) return null;

  const hasEnvGemini = Boolean(process.env.GEMINI_API_KEY || process.env.API_KEY);
  const hasEnvOpenAi = Boolean(process.env.OPENAI_API_KEY);

  const handleSaveGemini = () => {
    if (!storageOk) return;
    setGeminiKey(geminiInput);
    const updated = getGeminiKey();
    setStoredGemini(updated);
    setGeminiInput(updated || '');
  };

  const handleSaveOpenAi = () => {
    if (!storageOk) return;
    setOpenAiKey(openAiInput);
    const updated = getOpenAiKey();
    setStoredOpenAi(updated);
    setOpenAiInput(updated || '');
  };

  const handleForgetGemini = () => {
    clearGeminiKey();
    setStoredGemini(null);
    setGeminiInput('');
  };

  const handleForgetOpenAi = () => {
    clearOpenAiKey();
    setStoredOpenAi(null);
    setOpenAiInput('');
  };

  return (
    <div className="absolute right-0 top-14 w-[22rem] max-w-[90vw] rounded-xl border border-slate-700 bg-slate-900/95 shadow-2xl shadow-black/30 backdrop-blur-md z-20">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
        <div>
          <h3 className="text-sm font-semibold text-slate-100">Settings</h3>
          <p className="text-[11px] text-slate-400">Keys stay on this device only.</p>
        </div>
        <button
          onClick={onClose}
          className="p-1 text-slate-400 hover:text-white"
          aria-label="Close settings"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="px-4 py-3 space-y-4">
        {!storageOk && (
          <div className="rounded-lg border border-yellow-500/40 bg-yellow-500/10 px-3 py-2 text-[11px] text-yellow-200">
            Local storage is unavailable in this browser. Keys cannot be saved.
          </div>
        )}

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold text-slate-300">Gemini API Key</label>
            <span className={`text-[10px] px-2 py-0.5 rounded-full border ${storedGemini ? 'border-emerald-500/40 text-emerald-300 bg-emerald-500/10' : 'border-slate-600 text-slate-400 bg-slate-800/60'}`}>
              {storedGemini ? 'Stored' : (hasEnvGemini ? 'Env (dev)' : 'Not set')}
            </span>
          </div>
          <div className="relative">
            <input
              type={showGemini ? 'text' : 'password'}
              value={geminiInput}
              onChange={(e) => setGeminiInput(e.target.value)}
              placeholder="Paste Gemini key"
              className="w-full rounded-lg border border-slate-700 bg-slate-800/80 px-3 py-2 pr-14 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/60"
              autoComplete="off"
              spellCheck={false}
              disabled={!storageOk}
            />
            <button
              type="button"
              onClick={() => setShowGemini((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-slate-400 hover:text-slate-200"
            >
              {showGemini ? 'Hide' : 'Show'}
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleSaveGemini}
              disabled={!storageOk || !geminiInput.trim()}
              className="px-3 py-1.5 rounded-md text-xs font-semibold bg-indigo-500/20 text-indigo-200 border border-indigo-500/30 hover:bg-indigo-500/30 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Save
            </button>
            <button
              onClick={handleForgetGemini}
              className="px-3 py-1.5 rounded-md text-xs font-semibold bg-slate-700/70 text-slate-200 border border-slate-600 hover:border-slate-500"
            >
              Forget
            </button>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold text-slate-300">OpenAI API Key</label>
            <span className={`text-[10px] px-2 py-0.5 rounded-full border ${storedOpenAi ? 'border-emerald-500/40 text-emerald-300 bg-emerald-500/10' : 'border-slate-600 text-slate-400 bg-slate-800/60'}`}>
              {storedOpenAi ? 'Stored' : (hasEnvOpenAi ? 'Env (dev)' : 'Not set')}
            </span>
          </div>
          <div className="relative">
            <input
              type={showOpenAi ? 'text' : 'password'}
              value={openAiInput}
              onChange={(e) => setOpenAiInput(e.target.value)}
              placeholder="Paste OpenAI key"
              className="w-full rounded-lg border border-slate-700 bg-slate-800/80 px-3 py-2 pr-14 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-teal-500/60"
              autoComplete="off"
              spellCheck={false}
              disabled={!storageOk}
            />
            <button
              type="button"
              onClick={() => setShowOpenAi((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-slate-400 hover:text-slate-200"
            >
              {showOpenAi ? 'Hide' : 'Show'}
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleSaveOpenAi}
              disabled={!storageOk || !openAiInput.trim()}
              className="px-3 py-1.5 rounded-md text-xs font-semibold bg-teal-500/20 text-teal-200 border border-teal-500/30 hover:bg-teal-500/30 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Save
            </button>
            <button
              onClick={handleForgetOpenAi}
              className="px-3 py-1.5 rounded-md text-xs font-semibold bg-slate-700/70 text-slate-200 border border-slate-600 hover:border-slate-500"
            >
              Forget
            </button>
          </div>
        </div>

        <div className="text-[11px] text-slate-400 leading-relaxed border-t border-slate-800 pt-3">
          Keys are stored locally in your browser (localStorage) and are never sent to our servers. Requests go directly from your device to the provider APIs.
        </div>
      </div>
    </div>
  );
};

export default SettingsPanel;
