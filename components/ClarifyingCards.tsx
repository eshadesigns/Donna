"use client";

import { useState } from "react";
import type { ClarifyingQuestion } from "@/lib/gemini";

interface Props {
  questions: ClarifyingQuestion[];
  onSubmit: (answers: Record<string, string>) => void;
}

export default function ClarifyingCards({ questions, onSubmit }: Props) {
  const [answers, setAnswers] = useState<Record<string, string>>({});

  function set(id: string, value: string) {
    setAnswers((prev) => ({ ...prev, [id]: value }));
  }

  function handleSubmit() {
    onSubmit(answers);
  }

  const allAnswered = questions.every((q) => answers[q.id]?.trim());

  return (
    <div className="space-y-3">
      <p className="text-xs text-[#666] uppercase tracking-widest">Donna needs a few details</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {questions.map((q) => (
          <div key={q.id} className="bg-[#111] border border-[#222] rounded-xl p-4 space-y-2">
            <div className="flex items-center gap-2">
              <span>{q.icon}</span>
              <span className="text-xs text-[#888] font-medium uppercase tracking-wider">{q.label}</span>
            </div>
            <p className="text-sm text-[#ccc]">{q.question}</p>
            {q.inputType === "select" && q.options ? (
              <select
                className="w-full bg-[#0a0a0a] border border-[#333] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#8B0000]"
                value={answers[q.id] ?? ""}
                onChange={(e) => set(q.id, e.target.value)}
              >
                <option value="">Select...</option>
                {q.options.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                className="w-full bg-[#0a0a0a] border border-[#333] rounded-lg px-3 py-2 text-sm text-white placeholder-[#444] focus:outline-none focus:border-[#8B0000]"
                placeholder="Your answer..."
                value={answers[q.id] ?? ""}
                onChange={(e) => set(q.id, e.target.value)}
              />
            )}
          </div>
        ))}
      </div>
      <button
        onClick={handleSubmit}
        disabled={!allAnswered}
        className="w-full py-3 rounded-xl text-sm font-medium transition-all disabled:opacity-30 disabled:cursor-not-allowed"
        style={{ backgroundColor: "#8B0000", color: "#fff" }}
      >
        Let Donna handle it
      </button>
    </div>
  );
}
