import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BookOpen,
  Maximize2,
  Minimize2,
  MessageSquarePlus,
  SendHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import { api, streamCopilotChat } from "../../lib/api";
import type { ChatTurn } from "./ChatBubble";
import { ChatBubble } from "./ChatBubble";
import { Spinner } from "../ui/Spinner";
import { useCopilot } from "./CopilotContext";
import { formatHelpGuideMessage, HELP_TOPICS } from "../../lib/helpGuide";
import { nextQuestionSuggestions } from "../../lib/nextQuestions";

const SESSION_STORAGE_KEY = "vta-copilot-session-id";

const SUGGESTED_PROMPTS = [
  "Which checks are still awaiting a pay or hold decision?",
  "What checks have flagged an internal vendor-master discrepancy?",
  "Look up Duluth Trading Company on the open web and tell me if it’s safe to pay",
  "Summarize our riskiest vendor checks so far.",
];

function createSessionId(): string {
  const id = crypto.randomUUID();
  localStorage.setItem(SESSION_STORAGE_KEY, id);
  return id;
}

function getOrCreateSessionId(): string {
  const existing = localStorage.getItem(SESSION_STORAGE_KEY);
  if (existing) return existing;
  return createSessionId();
}

export function CopilotPanel() {
  const {
    open,
    closeCopilot,
    draft,
    setDraft,
    clearDraft,
    contextCheckId,
    showHelpGuide,
    clearHelpGuide,
  } = useCopilot();
  const queryClient = useQueryClient();
  const [sessionId, setSessionId] = useState(getOrCreateSessionId);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Expanded = readable long answers; compact = more page visible. No backdrop either way.
  const [expanded, setExpanded] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const history = useQuery({
    queryKey: ["copilot-history", sessionId],
    queryFn: () => api.getCopilotHistory(sessionId),
    enabled: open,
  });

  useEffect(() => {
    if (history.data && turns.length === 0 && !showHelpGuide) {
      setTurns(
        history.data.map((m) => ({ role: m.role, content: m.content, citations: m.citations }))
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history.data, showHelpGuide]);

  // Keep help open via context flag (do NOT clear in an effect — React Strict
  // Mode remounts wipe local state after clearHelpGuide, which hid the guide).
  useEffect(() => {
    if (open && showHelpGuide && scrollRef.current) {
      scrollRef.current.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [open, showHelpGuide]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, status]);

  useEffect(() => {
    if (open) {
      const t = window.setTimeout(() => inputRef.current?.focus(), 80);
      return () => window.clearTimeout(t);
    }
  }, [open, draft]);

  const followUps = useMemo(() => {
    if (isStreaming) return [];
    if (showHelpGuide) {
      return nextQuestionSuggestions({ lastAssistant: "", showingHelp: true, contextCheckId });
    }
    const lastAssistant = [...turns].reverse().find((t) => t.role === "assistant");
    const lastUser = [...turns].reverse().find((t) => t.role === "user");
    if (!lastAssistant) return [];
    return nextQuestionSuggestions({
      lastAssistant: lastAssistant.content,
      lastUser: lastUser?.content,
      contextCheckId,
    });
  }, [turns, isStreaming, showHelpGuide, contextCheckId]);

  async function startNewSession() {
    if (isStreaming) return;
    const previousId = sessionId;
    // Best-effort wipe of stored turns for the old session.
    try {
      await api.clearCopilotHistory(previousId);
    } catch {
      // Still start a fresh client session even if delete fails.
    }
    queryClient.removeQueries({ queryKey: ["copilot-history", previousId] });
    const nextId = createSessionId();
    setSessionId(nextId);
    setTurns([]);
    setError(null);
    setStatus(null);
    clearDraft();
    clearHelpGuide();
    window.setTimeout(() => inputRef.current?.focus(), 80);
  }

  async function send(message: string) {
    if (!message.trim() || isStreaming) return;
    setError(null);
    clearHelpGuide();
    clearDraft();
    setTurns((prev) => [...prev, { role: "user", content: message }]);
    setIsStreaming(true);
    setStatus("Working…");

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
      setError(err instanceof Error ? err.message : "Ask AI request failed.");
    } finally {
      setIsStreaming(false);
      setStatus(null);
    }
  }

  if (!open) return null;

  const canStartNew = !isStreaming && (turns.length > 0 || Boolean(history.data?.length));

  return (
    // Floating panel — no backdrop. Expanded for reading; compact for more page room.
    <aside
      className={
        expanded
          ? "fixed bottom-4 right-4 z-50 flex w-[min(100vw-1.5rem,40rem)] flex-col overflow-hidden rounded-2xl border border-slate-300 bg-[var(--color-surface)] shadow-2xl shadow-slate-900/20"
          : "fixed bottom-5 right-5 z-50 flex w-[min(100vw-1.5rem,26rem)] flex-col overflow-hidden rounded-2xl border border-slate-300 bg-[var(--color-surface)] shadow-2xl shadow-slate-900/20"
      }
      style={{ height: expanded ? "min(86vh, 52rem)" : "min(58vh, 32rem)" }}
      role="dialog"
      aria-label="Ask AI"
    >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 bg-white px-3.5 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-teal-50 text-teal-700">
                <Sparkles className="h-3.5 w-3.5" />
              </div>
              <div className="min-w-0">
                <h2 className="text-sm font-bold text-slate-800">Ask AI</h2>
                <p className="text-[10px] font-semibold tracking-wide text-teal-700">
                  Powered by Tavily
                </p>
              </div>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
              Past reports, approved list, or a live Tavily lookup.
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
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              title={expanded ? "Compact panel — more page visible" : "Expand panel — easier to read"}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-semibold text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900"
              aria-label={expanded ? "Compact Ask AI" : "Expand Ask AI"}
            >
              {expanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
              {expanded ? "Compact" : "Expand"}
            </button>
            <button
              type="button"
              onClick={() => void startNewSession()}
              disabled={!canStartNew}
              title="Clear this chat and start a new session"
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-semibold text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="New chat"
            >
              <MessageSquarePlus className="h-3.5 w-3.5" />
              New chat
            </button>
            <button
              onClick={closeCopilot}
              className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-700"
              aria-label="Close Ask AI"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {showHelpGuide && (
            <div className="rounded-xl border border-teal-200 bg-white px-4 py-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-teal-800">
                  <BookOpen className="h-4 w-4" />
                  <p className="text-sm font-bold">How to use Vendor Trust</p>
                </div>
                <button
                  type="button"
                  onClick={clearHelpGuide}
                  className="text-[11px] font-semibold text-slate-500 hover:text-slate-800"
                >
                  Dismiss
                </button>
              </div>
              <p className="mb-3 text-xs leading-relaxed text-slate-600">{formatHelpGuideMessage().split("\n")[0]}</p>
              <div className="space-y-3">
                {HELP_TOPICS.map((topic) => (
                  <button
                    key={topic.title}
                    type="button"
                    onClick={() => setDraft(topic.askNext)}
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-left transition-colors hover:border-teal-300 hover:bg-teal-50"
                  >
                    <p className="text-xs font-bold text-slate-800">{topic.title}</p>
                    <p className="mt-1 text-[11px] leading-relaxed text-slate-600">{topic.body}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {turns.length === 0 && !history.isLoading && !showHelpGuide && (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-slate-300 bg-white px-4 py-8 text-center">
              <p className="max-w-xs text-xs leading-relaxed text-slate-500">
                Ask about invoice history, your approved-vendor list, or run a live Tavily lookup.
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
            <div key={i} className="space-y-2">
              <ChatBubble turn={turn} />
              {turn.role === "assistant" &&
                i === turns.length - 1 &&
                !isStreaming &&
                !showHelpGuide &&
                followUps.length > 0 && (
                  <div className="ml-11 space-y-1.5">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                      Suggested next questions
                    </p>
                    {followUps.map((q) => (
                      <button
                        key={q}
                        type="button"
                        onClick={() => setDraft(q)}
                        className="block w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-left text-[11px] text-slate-700 hover:border-teal-300 hover:bg-teal-50"
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                )}
            </div>
          ))}

          {showHelpGuide && followUps.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                Suggested next questions
              </p>
              {followUps.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => setDraft(q)}
                  className="block w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-left text-[11px] text-slate-700 hover:border-teal-300 hover:bg-teal-50"
                >
                  {q}
                </button>
              ))}
            </div>
          )}

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
  );
}
