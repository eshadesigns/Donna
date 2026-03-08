"use client";

import type { RankedBusiness } from "@/lib/gemini";

interface BusinessUpdate {
  name: string;
  status: string;
  detail: string;
  url?: string;
  callId?: string;
  scheduledTime?: string;
}

interface Props {
  business: RankedBusiness;
  update?: BusinessUpdate;
  rank: number;
}

const statusBadge: Record<string, { label: string; color: string }> = {
  calling:        { label: "On the phone",      color: "#8B0000" },
  call_initiated: { label: "Call placed",        color: "#8B0000" },
  booked_online:  { label: "Book online",        color: "#1a6b1a" },
  booked:         { label: "Booked",             color: "#1a6b1a" },
  queued:         { label: "Calling tomorrow",   color: "#5a4a00" },
  failed:         { label: "Couldn't reach",     color: "#333" },
  skipped:        { label: "No phone",           color: "#333" },
};

export default function BusinessCard({ business, update, rank }: Props) {
  const badge = update ? statusBadge[update.status] : null;

  return (
    <div className="bg-[#111] border border-[#222] rounded-xl p-4 space-y-3 transition-all">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="text-xs text-[#555] font-mono w-5">#{rank}</span>
          <div>
            <p className="text-sm font-medium text-white">{business.name}</p>
            <p className="text-xs text-[#666] mt-0.5">{business.address}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-[#555]">{business.score}/10</span>
          {badge && (
            <span
              className="text-xs px-2 py-0.5 rounded-full font-medium"
              style={{ backgroundColor: badge.color + "33", color: badge.color === "#333" ? "#666" : badge.color }}
            >
              {badge.label}
            </span>
          )}
        </div>
      </div>

      <p className="text-xs text-[#666] leading-relaxed">{business.reasoning}</p>

      {update && (
        <p className="text-xs text-[#888] border-t border-[#1a1a1a] pt-2">{update.detail}</p>
      )}

      {update?.status === "booked_online" && update.url && (
        <a
          href={update.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block text-xs underline"
          style={{ color: "#8B0000" }}
        >
          Book now →
        </a>
      )}
    </div>
  );
}
