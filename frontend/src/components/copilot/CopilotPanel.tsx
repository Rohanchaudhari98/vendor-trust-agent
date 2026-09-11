import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { SendHorizontal, Sparkles, X } from "lucide-react";
import { api, streamCopilotChat } from "../../lib/api";
import type { ChatTurn } from "./ChatBubble";
import { ChatBubble } from "./ChatBubble";
import { Spinner } from "../ui/Spinner";
import { useCopilot } from "./CopilotContext";

const SESSION_STORAGE_KEY = "vta-copilot-session-id";

const SUGGESTED_PROMPTS = [
  "What checks have flagged an internal vendor-master discrepancy?",
  "Is Procter & Gamble an approved vendor on file?",
  "Have we seen anything like a forex trading fraud risk before?",
  "Summarize our riskiest vendor checks so far.",
];

function getOrCreateSessionId(): string {
  const existing = localStorage.getItem(SESSION_STORAGE_KEY);
  if (existing) return existing;
  const id = crypto.randomUUID();
  localStorage.setItem(SESSION_STORAGE_KEY, id);
  return id;
}

export function CopilotPanel() {
  const { open, closeCopilot, draft, setDraft, clearDraft, contextCheckId } = useCopilot();
  const [sessionId] = useState(getOrCreateSessionId);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const history = useQuery({
    queryKey: ["copilot-history", sessionId],
    queryFn: () => api.getCopilotHistory(sessionId),
    enabled: open,
  });

  useEffect(() => {
    if (history.data && turns.length === 0) {
      setTurns(
        history.data.map((m) => ({ role: m.role, content: m.content, citations: m.citations }))
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history.data]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, status]);

  useEffect(() => {
    if (open) {
      // Focus after slide-in so the prefilled draft is ready to edit/send.
      const t = window.setTimeout(() => inputRef.current?.focus(), 80);
      return () => window.clearTimeout(t);
    }
  }, [open, draft]);

  async function send(message: string) {
    if (!message.trim() || isStreaming) return;
    setError(null);
    clearDraft();
    setTurns((prev) => [...prev, { role: "user", content: message }]);
    setIsStreaming(true);
    setStatus("Thinking…");

    try {
      await streamCopilotChat(
        sessionId,
        message,
        (event) => {
          if (event.type === "status") {
            setStatus(event.message);
          } else if (event.type === "answer") {
            setStatus(null);
            setTurns((prev) => [
              ...prev,
              {
                role: "assistant",
                content: event.text,
                citations: event.citations,
                checkIds: event.check_ids,
              },
            ]);
          } else if (event.type === "error") {
            setStatus(null);
            setError(event.message);
          }
        },
        undefined,
        contextCheckId
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Copilot request failed.");
    } finally {
      setIsStreaming(false);
      setStatus(null);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-slate-900/40" onClick={closeCopilot} />
      <aside className="relative flex h-full w-full max-w-md flex-col border-l border-slate-200 bg-[var(--color-surface)] shadow-2xl">
        <header className="flex items-start justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3.5">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-teal-50 text-teal-700">
                <Sparkles className="h-3.5 w-3.5" />
              </div>
              <h2 className="text-sm font-bold text-slate-800">Ask AI</h2>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
              Past reports, approved list, or a live Tavily lookup. Answers always cite sources.
              {contextCheckId != null ? (
                <>
                  {" "}
                  <span className="font-semibold text-teal-800">
                    Viewing report #{contextCheckId}
                  </span>
                </>
              ) : null}
            </p>
          </div>
          <button
            onClick={closeCopilot}
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-700"
            aria-label="Close Ask AI"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {turns.length === 0 && !history.isLoading && (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-slate-300 bg-white px-4 py-8 text-center">
              <p className="max-w-xs text-xs leading-relaxed text-slate-500">
                Try one of these — grounded in check history, your vendor master, or live Tavily
                search.
              </p>
              <div className="grid w-full gap-1.5">
                {SUGGESTED_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    onClick={() => setDraft(prompt)}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-left text-xs text-slate-700 shadow-sm transition-colors hover:border-blue-200 hover:bg-blue-50"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          )}

          {turns.map((turn, i) => (
            <ChatBubble key={i} turn={turn} />
          ))}

          {status && (
            <div className="flex items-center gap-2 pl-11 text-xs font-medium text-slate-500">
              <Spinner className="h-3.5 w-3.5" /> {status}
            </div>
          )}
          {error && (
            <div className="ml-11 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
        </div>

        <form
          className="border-t border-slate-200 bg-white px-3 py-3"
          onSubmit={(e) => {
            e.preventDefault();
            send(draft);
          }}
        >
          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Ask about this report, past checks, or vendors…"
              disabled={isStreaming}
              className="flex-1 rounded-lg border-0 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 shadow-sm ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:bg-white focus:ring-2 focus:ring-inset focus:ring-blue-500 disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={isStreaming || !draft.trim()}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="Send"
            >
              {isStreaming ? (
                <Spinner className="h-4 w-4 text-white" />
              ) : (
                <SendHorizontal className="h-4 w-4" />
              )}
            </button>
          </div>
        </form>
      </aside>
    </div>
  );
}
