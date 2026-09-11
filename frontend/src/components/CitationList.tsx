import { ExternalLink, Globe, Lock } from "lucide-react";
import type { Citation } from "../lib/types";

export function CitationList({
  citations,
  compact = false,
}: {
  citations: Citation[];
  compact?: boolean;
}) {
  if (citations.length === 0) return null;

  return (
    <ul className={`space-y-1.5 ${compact ? "mt-2" : "mt-2.5"}`}>
      {citations.map((c, i) =>
        c.source_type === "internal" ? (
          <li
            key={i}
            className="flex items-start gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-600"
          >
            <span className="mt-0.5 inline-flex shrink-0 items-center gap-1 rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-600">
              <Lock className="h-3 w-3" />
              Internal
            </span>
            <span className="min-w-0 leading-snug">
              {compact ? (
                <span className="text-slate-500">Approved-vendor list</span>
              ) : (
                <>
                  {c.claim}
                  <span className="mt-0.5 block text-[10px] text-slate-400">
                    Internal Vendor Master
                  </span>
                </>
              )}
            </span>
          </li>
        ) : (
          <li
            key={i}
            className="flex items-start gap-2 rounded-lg border border-teal-300 bg-teal-50/80 px-2.5 py-2 text-xs text-slate-700 shadow-[inset_3px_0_0_0_#0d9488]"
          >
            <span className="mt-0.5 inline-flex shrink-0 items-center gap-1 rounded bg-teal-600 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
              <Globe className="h-3 w-3" />
              Tavily
            </span>
            <span className="min-w-0 leading-snug">
              {!compact && c.claim ? (
                <span className="mb-0.5 block text-slate-600">{c.claim}</span>
              ) : null}
              {c.source_url ? (
                <a
                  href={c.source_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex max-w-full items-center gap-1 truncate font-semibold text-teal-800 hover:text-teal-950"
                >
                  <ExternalLink className="h-3 w-3 shrink-0" />
                  <span className="truncate">{c.source_title || c.source_url}</span>
                </a>
              ) : (
                <span className="font-medium text-slate-600">{c.source_title}</span>
              )}
            </span>
          </li>
        ),
      )}
    </ul>
  );
}
