"use client";

interface Update {
  name: string;
  status: string;
  detail: string;
  timestamp: Date;
}

interface Props {
  updates: Update[];
}

const statusIcon: Record<string, string> = {
  booked:         "✓",
  booked_online:  "✓",
  call_initiated: "📞",
  calling:        "📞",
  queued:         "⏰",
  failed:         "✗",
  skipped:        "—",
};

export default function NotificationFeed({ updates }: Props) {
  if (updates.length === 0) return null;

  return (
    <div className="space-y-2">
      <p className="text-xs text-[#555] uppercase tracking-widest">Updates</p>
      <div className="space-y-2">
        {[...updates].reverse().map((u, i) => (
          <div key={i} className="flex items-start gap-3 bg-[#0d0d0d] border border-[#1a1a1a] rounded-lg px-3 py-2.5">
            <span className="text-xs mt-0.5 w-4 shrink-0 text-center text-[#666]">
              {statusIcon[u.status] ?? "•"}
            </span>
            <div className="min-w-0">
              <p className="text-xs font-medium text-[#ccc] truncate">{u.name}</p>
              <p className="text-xs text-[#555] leading-relaxed mt-0.5">{u.detail}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
