import React from 'react';

interface SetupModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenSettings: () => void;
}

const SetupModal: React.FC<SetupModalProps> = ({ isOpen, onClose, onOpenSettings }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-slate-950/70 backdrop-blur-none"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        className="relative z-10 w-[28rem] max-w-[92vw] rounded-2xl border border-rose-300/40 bg-slate-900/95 p-5 shadow-2xl shadow-black/40"
      >
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-rose-500/20 border border-rose-300/40 flex items-center justify-center text-rose-200">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <h2 className="text-base font-semibold text-slate-100">Set up your API keys</h2>
            <p className="text-xs text-slate-400">You need keys before starting translation.</p>
          </div>
        </div>

        <div className="mt-4 text-sm text-slate-200 leading-relaxed">
          Open <span className="font-semibold text-rose-200">Settings/Keys</span> in the header and paste your Gemini or OpenAI API key.
          Keys are stored locally in your browser and never sent to our servers.
        </div>

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-2 rounded-md text-xs font-semibold bg-slate-800/80 text-slate-200 border border-slate-700 hover:border-slate-500"
          >
            Dismiss
          </button>
          <button
            onClick={onOpenSettings}
            className="px-3 py-2 rounded-md text-xs font-semibold bg-rose-500/25 text-rose-100 border border-rose-300/60 hover:bg-rose-500/35 hover:border-rose-200/80"
          >
            Open Settings/Keys
          </button>
        </div>
      </div>
    </div>
  );
};

export default SetupModal;
