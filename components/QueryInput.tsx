"use client";

import { useState, KeyboardEvent } from "react";

interface Props {
  onSubmit: (query: string) => void;
  disabled?: boolean;
}

export default function QueryInput({ onSubmit, disabled }: Props) {
  const [value, setValue] = useState("");

  function handleSubmit() {
    const q = value.trim();
    if (!q || disabled) return;
    onSubmit(q);
    setValue("");
  }

  function handleKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  return (
    <div className="flex gap-3 items-end">
      <textarea
        className="flex-1 bg-[#111] border border-[#333] rounded-xl px-4 py-3 text-white placeholder-[#555] resize-none focus:outline-none focus:border-[#8B0000] transition-colors text-sm leading-relaxed"
        rows={2}
        placeholder="What do you need Donna to handle?"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKey}
        disabled={disabled}
      />
      <button
        onClick={handleSubmit}
        disabled={disabled || !value.trim()}
        className="px-5 py-3 rounded-xl text-sm font-medium transition-all disabled:opacity-30 disabled:cursor-not-allowed"
        style={{ backgroundColor: "#8B0000", color: "#fff" }}
      >
        Send
      </button>
    </div>
  );
}
