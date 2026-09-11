import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { SendHorizontal, Sparkles } from "lucide-react";
import { api, streamCopilotChat } from "../lib/api";
import type { ChatTurn } from "../components/copilot/ChatBubble";
import { ChatBubble } from "../components/copilot/ChatBubble";
import { PageHeader } from "../components/ui/PageHeader";
import { Spinner } from "../components/ui/Spinner";

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

export function CopilotPage() {
  const [sessionId] = useState(getOrCreateSessionId);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const history = useQuery({
    queryKey: ["copilot-history", sessionId],
    queryFn: () => api.getCopilotHistory(sessionId),
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

  async function send(message: string) {
    if (!message.trim() || isStreaming) return;
    setError(null);
    setInput("");
    setTurns((prev) => [...prev, { role: "user", content: message }]);
    setIsStreaming(true);
    setStatus("Thinking…");

    try {
      await streamCopilotChat(sessionId, message, (event) => {
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
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Copilot request failed.");
    } finally {
      setIsStreaming(false);
      setStatus(null);
    }
  }

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col px-6 py-7 lg:px-8">
      <PageHeader
        title="Ask AI"
        subtitle="Ask about past reports or your approved list — or run a live Tavily web lookup. Answers always cite sources."
      />

      <div ref={scrollRef} className="mt-6 flex-1 space-y-5 overflow-y-auto pb-4">
        {turns.length === 0 && !history.isLoading && (
          <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
            <div className="rounded-xl border border-teal-100 bg-teal-50 p-3">
              <Sparkles className="h-5 w-5 text-teal-700" />
            </div>
            <p className="max-w-md text-sm leading-relaxed text-slate-500">
              Try one of these — answers come from real check history, your vendor master, or a live
              Tavily search — never from ungrounded model knowledge.
            </p>
            <div className="grid w-full max-w-lg gap-2">
              {SUGGESTED_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => send(prompt)}
                  className="rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-left text-sm text-slate-700 shadow-sm transition-colors hover:border-blue-200 hover:bg-blue-50"
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
        className="mt-2 flex items-center gap-2 border-t border-slate-300 bg-[var(--color-surface)] pt-4"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about vendor risk, past checks, or run a new one…"
          disabled={isStreaming}
          className="flex-1 rounded-lg border-0 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-blue-500 disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={isStreaming || !input.trim()}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          aria-label="Send"
        >
          {isStreaming ? <Spinner className="h-4 w-4 text-white" /> : <SendHorizontal className="h-4 w-4" />}
        </button>
      </form>
    </div>
  );
}
