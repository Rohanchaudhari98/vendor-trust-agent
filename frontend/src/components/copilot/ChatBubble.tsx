import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Bot, User } from "lucide-react";
import type { Citation } from "../../lib/types";
import { SourcesSection } from "./SourcesSection";
import { InlineCheckCard } from "../InlineCheckCard";

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  checkIds?: number[];
}

export function ChatBubble({ turn }: { turn: ChatTurn }) {
  const isUser = turn.role === "user";
  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""}`}>
      <div
        className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
          isUser ? "bg-slate-800 text-white" : "bg-sidebar-active text-white"
        }`}
      >
        {isUser ? <User className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
      </div>
      <div className={`max-w-[min(100%,22rem)] space-y-2 sm:max-w-[85%] ${isUser ? "items-end" : ""}`}>
        <div
          className={`rounded-xl px-4 py-3 text-sm ${
            isUser
              ? "rounded-tr-md bg-slate-800 text-white"
              : "rounded-tl-md border border-slate-200 bg-white text-slate-800 shadow-sm"
          }`}
        >
          {isUser ? (
            <p className="whitespace-pre-wrap leading-relaxed">{turn.content}</p>
          ) : (
            <div className="prose-copilot">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{turn.content}</ReactMarkdown>
            </div>
          )}
          {!isUser && turn.citations && <SourcesSection citations={turn.citations} />}
        </div>

        {!isUser && turn.checkIds && turn.checkIds.length > 0 && (
          <div className="space-y-2">
            {turn.checkIds.map((id) => (
              <InlineCheckCard key={id} checkId={id} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
