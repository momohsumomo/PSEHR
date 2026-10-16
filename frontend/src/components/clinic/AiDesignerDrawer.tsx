import { useState } from "react";

interface Message {
  sender: "user" | "ai" | "system";
  text: string;
}

interface Props {
  onClose: () => void;
  aiLog: Message[];
  aiLoading: boolean;
  onSendCommand: (command: string) => void;
  geminiKey: string;
  onGeminiKeyChange: (key: string) => void;
}

export function AiDesignerDrawer({
  onClose,
  aiLog,
  aiLoading,
  onSendCommand,
  geminiKey,
  onGeminiKeyChange,
}: Props) {
  const [aiInput, setAiInput] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!aiInput.trim()) return;
    onSendCommand(aiInput);
    setAiInput("");
  };

  const suggestions = [
    "掛號清單放右邊",
    "照片區放左邊",
    "隱藏照片區",
    "放大處方開藥",
    "還原預設排版",
  ];

  return (
    <div className="absolute inset-y-0 right-0 w-80 bg-slate-900/95 text-slate-100 shadow-2xl border-l border-slate-700/50 backdrop-blur z-50 flex flex-col p-4 transition duration-200 ease-out transform translate-x-0">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-2 mb-3">
        <div className="flex items-center gap-1.5">
          <span className="text-base">🤖</span>
          <h3 className="font-bold text-sm tracking-wide text-slate-200">
            Wundadi AI 介面設計師
          </h3>
        </div>
        <button
          type="button"
          className="text-slate-400 hover:text-white text-[11px] px-1.5 py-0.5 rounded border border-slate-700 hover:bg-slate-800"
          onClick={onClose}
        >
          關閉
        </button>
      </div>

      {/* Chat Messages */}
      <div className="flex-1 overflow-y-auto space-y-2 mb-3 pr-1 text-xs scrollbar-thin scrollbar-thumb-slate-800">
        {aiLog.map((msg, idx) => (
          <div
            key={idx}
            className={`p-2 rounded max-w-[90%] leading-relaxed ${
              msg.sender === "user"
                ? "bg-violet-600 text-white ml-auto"
                : msg.sender === "ai"
                  ? "bg-slate-800 text-slate-200 mr-auto border border-slate-700/60"
                  : "bg-red-955/40 text-red-300 border border-red-900/40 mr-auto font-mono"
            }`}
          >
            {msg.text}
          </div>
        ))}
        {aiLoading && (
          <div className="bg-slate-800/60 text-slate-400 p-2 rounded mr-auto italic animate-pulse">
            AI 正在調整介面排版中…
          </div>
        )}
      </div>

      {/* Suggestions */}
      <div className="mb-3 space-y-1">
        <span className="text-[10px] text-slate-500 block font-semibold">
          快速指令：
        </span>
        <div className="flex flex-wrap gap-1">
          {suggestions.map((sug) => (
            <button
              key={sug}
              type="button"
              disabled={aiLoading}
              className="text-[10px] px-1.5 py-0.5 bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white rounded border border-slate-700/80 transition"
              onClick={() => onSendCommand(sug)}
            >
              {sug}
            </button>
          ))}
        </div>
      </div>

      {/* API Key */}
      <div className="mb-3 border-t border-slate-800 pt-2">
        <label className="text-[9px] text-slate-500 block mb-0.5 font-semibold">
          GEMINI_API_KEY (可選，存在本地)：
        </label>
        <input
          type="password"
          placeholder="輸入您的 Gemini API Key"
          value={geminiKey}
          onChange={(e) => onGeminiKeyChange(e.target.value)}
          className="w-full bg-slate-800 text-slate-200 border border-slate-700 rounded p-1 text-[10px] focus:outline-none focus:border-violet-500"
        />
      </div>

      {/* Chat Input */}
      <form onSubmit={handleSubmit} className="flex gap-1 border-t border-slate-800 pt-2">
        <input
          type="text"
          placeholder="輸入變形指令..."
          value={aiInput}
          onChange={(e) => setAiInput(e.target.value)}
          disabled={aiLoading}
          className="flex-1 bg-slate-800 text-slate-100 border border-slate-700 rounded px-2 py-1 text-xs focus:outline-none focus:border-violet-500 placeholder-slate-500"
        />
        <button
          type="submit"
          disabled={aiLoading || !aiInput.trim()}
          className="bg-violet-600 hover:bg-violet-700 text-white font-bold text-xs px-3 py-1 rounded disabled:opacity-40 transition"
        >
          傳送
        </button>
      </form>
    </div>
  );
}
