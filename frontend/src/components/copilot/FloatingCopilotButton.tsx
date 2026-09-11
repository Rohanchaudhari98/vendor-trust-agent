import { MessageSquare } from "lucide-react";
import { useCopilot } from "./CopilotContext";

/** Persistent bottom-right launcher — the only entry point for Ask AI. */
export function FloatingCopilotButton() {
  const { open, openCopilot } = useCopilot();

  if (open) return null;

  return (
    <button
      type="button"
      onClick={() => openCopilot()}
      className="fixed bottom-5 right-5 z-40 flex h-12 items-center gap-2 rounded-full bg-teal-700 px-4 text-sm font-semibold text-white shadow-lg shadow-teal-900/20 transition hover:bg-teal-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2"
      aria-label="Ask AI"
    >
      <MessageSquare className="h-4 w-4" />
      Ask AI
    </button>
  );
}
