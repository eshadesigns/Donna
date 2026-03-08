"use client";

type Phase = "idle" | "clarifying" | "searching" | "ranking" | "working" | "done" | "error";

interface Props {
  phase: Phase;
  message?: string;
}

const phaseConfig: Record<Phase, { label: string; pulse: boolean }> = {
  idle:       { label: "",                              pulse: false },
  clarifying: { label: "Donna needs a few details.",   pulse: false },
  searching:  { label: "Donna's scanning the web...",  pulse: true  },
  ranking:    { label: "Ranking the best options...",  pulse: true  },
  working:    { label: "Donna's on it.",               pulse: true  },
  done:       { label: "Done. You're all set.",        pulse: false },
  error:      { label: "Something went wrong.",        pulse: false },
};

export default function StatusTracker({ phase, message }: Props) {
  if (phase === "idle") return null;

  const config = phaseConfig[phase];
  const displayMessage = message || config.label;

  return (
    <div className="flex items-center gap-3 py-2">
      {config.pulse && (
        <span className="relative flex h-2.5 w-2.5">
          <span
            className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75"
            style={{ backgroundColor: "#8B0000" }}
          />
          <span
            className="relative inline-flex rounded-full h-2.5 w-2.5"
            style={{ backgroundColor: "#8B0000" }}
          />
        </span>
      )}
      {phase === "done" && (
        <span className="text-green-500 text-sm">✓</span>
      )}
      {phase === "error" && (
        <span className="text-red-400 text-sm">✗</span>
      )}
      <span className={`text-sm ${phase === "error" ? "text-red-400" : "text-[#aaa]"}`}>
        {displayMessage}
      </span>
    </div>
  );
}
