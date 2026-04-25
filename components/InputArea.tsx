import React, { useState } from 'react';
import { Send, BookOpen } from 'lucide-react';

interface InputAreaProps {
  onSearch: (topic: string) => void;
  disabled: boolean;
  uiLanguage?: "ko" | "en";
}

export const InputArea: React.FC<InputAreaProps> = ({ onSearch, disabled, uiLanguage = "ko" }) => {
  const [input, setInput] = useState('');
  const ui = (ko: string, en: string) => uiLanguage === "ko" ? ko : en;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim() && !disabled) {
      onSearch(input.trim());
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto mb-8">
      <form onSubmit={handleSubmit} className="relative group">
        <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
          <BookOpen className="text-gray-400 w-6 h-6" />
        </div>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={disabled}
          placeholder={ui("무엇이 궁금해? (예: 양자역학, 광합성, 비트코인)", "What are you curious about? (e.g. quantum mechanics, photosynthesis, Bitcoin)")}
          className="w-full pl-12 pr-14 py-4 bg-white border-4 border-black rounded-xl text-lg font-bold text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-4 focus:ring-yellow-300 transition-all comic-shadow disabled:bg-gray-100 disabled:cursor-not-allowed"
        />
        <button
          type="submit"
          disabled={disabled || !input.trim()}
          className="absolute right-2 top-2 bottom-2 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 text-white rounded-lg px-4 flex items-center justify-center border-2 border-black transition-all active:scale-95"
        >
          <Send className="w-5 h-5" />
        </button>
      </form>
    </div>
  );
};
