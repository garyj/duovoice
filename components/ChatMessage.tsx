import React, { memo } from 'react';
import { Message } from '../types';

interface ChatMessageProps {
  message: Message;
}

const ChatMessage: React.FC<ChatMessageProps> = memo(({ message }) => {
  const isModel = message.role === 'model';
  
  return (
    <div className={`flex w-full mb-4 ${isModel ? 'justify-start' : 'justify-end'}`}>
      <div 
        className={`max-w-[80%] px-4 py-3 rounded-2xl shadow-md text-sm md:text-base leading-relaxed
          ${isModel 
            ? 'bg-slate-700 text-slate-100 rounded-tl-none' 
            : 'bg-blue-600 text-white rounded-tr-none'
          }
          ${!message.isFinal ? 'opacity-70 animate-pulse' : 'opacity-100'}
        `}
      >
        <p>{message.text}</p>
        <span className="text-[10px] opacity-50 mt-1 block text-right">
          {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
    </div>
  );
});

export default ChatMessage;