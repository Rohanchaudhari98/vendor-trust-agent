import { ExternalLink, Lock } from "lucide-react";
import type { Citation } from "../../lib/types";

export function SourcesSection({ citations }: { citations: Citation[] }) {
  if (citations.length === 0) return null;
  const webCitations = citations.filter((c) => c.source_type === "web");
  const internalCitations = citations.filter((c) => c.source_type === "internal");

  return (
    <div className="mt-3 border-t border-slate-200 pt-3">
      <p className="mb-2 section-label">Sources</p>
      <ul className="space-y-1.5">
        {webCitations.map((c, i) => (
          <li
            key={`web-${i}`}
            className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs text-slate-600"
          >
            <span className="mt-0.5 inline-flex shrink-0 items-center gap-1 rounded border border-teal-200 bg-teal-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-teal-700">
              <ExternalLink className="h-3 w-3" />
              Tavily
            </span>
            <span className="min-w-0 leading-relaxed">
              {c.claim}{" "}
              {c.source_url ? (
                <a
                  href={c.source_url}
                  target="_blank"
                  rel="noreferrer"
                  className="font-semibold text-blue-600 hover:text-blue-700"
                >
                  {c.source_title || c.source_url}
                </a>
              ) : null}
            </span>
          </li>
        ))}
        {internalCitations.map((c, i) => (
          <li
            key={`internal-${i}`}
            className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs text-slate-600"
          >
            <span className="mt-0.5 inline-flex shrink-0 items-center gap-1 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
              <Lock className="h-3 w-3" />
              Internal
            </span>
            <span className="leading-relaxed">
              {c.claim}
              <span className="mt-0.5 block text-[10px] text-slate-400">Internal Vendor Master</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
