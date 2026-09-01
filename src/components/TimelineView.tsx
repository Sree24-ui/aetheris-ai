import type { TimelineEvent } from "@/lib/types";

export default function TimelineView({ events }: { events: TimelineEvent[] }) {
  return (
    <div className="w-full max-w-2xl mx-auto py-2">
      <div className="relative border-l-2 border-primary/40 ml-3">
        {events.map((e, i) => (
          <div key={i} className="mb-5 ml-5 relative">
            <span className="absolute -left-[27px] top-1 w-3 h-3 rounded-full bg-primary ring-4 ring-primary-container/20" />
            <div className="text-xs font-semibold text-primary-fixed-dim">{e.date}</div>
            <div className="text-sm text-on-surface">{e.event}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
