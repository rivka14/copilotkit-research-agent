"use client";

// Generative UI card rendered in chat when the agent calls its backend
// search_web tool. `query` comes from streamed tool-call args and may be
// undefined until the args finish arriving.
export function SearchCard({ query }: { query?: string }) {
  return (
    <div className="flex items-center gap-3 bg-slate-800 text-white rounded-xl p-3 my-2 shadow">
      <span className="text-lg" role="img" aria-label="search">
        🔍
      </span>
      <div className="min-w-0">
        <p className="text-xs text-slate-400">Searching the web</p>
        <p className="text-sm font-medium truncate">{query || "…"}</p>
      </div>
    </div>
  );
}
