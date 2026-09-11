import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type OpenCopilotOptions = {
  /** Prefill the composer; user still hits send (never auto-runs). */
  draft?: string;
  /** Silent page context — e.g. the report currently open. */
  contextCheckId?: number | null;
  /** Open Ask AI with the in-app how-to-use guide. */
  showHelpGuide?: boolean;
};

type CopilotContextValue = {
  open: boolean;
  draft: string;
  contextCheckId: number | null;
  showHelpGuide: boolean;
  openCopilot: (opts?: OpenCopilotOptions) => void;
  closeCopilot: () => void;
  /** Set page context without opening the panel (report detail mount). */
  setContextCheckId: (id: number | null) => void;
  setDraft: (value: string) => void;
  clearDraft: () => void;
  clearHelpGuide: () => void;
};

const CopilotContext = createContext<CopilotContextValue | null>(null);

export function CopilotProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [contextCheckId, setContextCheckId] = useState<number | null>(null);
  const [showHelpGuide, setShowHelpGuide] = useState(false);

  const openCopilot = useCallback((opts?: OpenCopilotOptions) => {
    if (opts?.draft != null) setDraft(opts.draft);
    if (opts && "contextCheckId" in opts) {
      setContextCheckId(opts.contextCheckId ?? null);
    }
    setShowHelpGuide(Boolean(opts?.showHelpGuide));
    setOpen(true);
  }, []);

  const closeCopilot = useCallback(() => {
    setOpen(false);
    setShowHelpGuide(false);
  }, []);
  const clearDraft = useCallback(() => setDraft(""), []);
  const clearHelpGuide = useCallback(() => setShowHelpGuide(false), []);

  const value = useMemo(
    () => ({
      open,
      draft,
      contextCheckId,
      showHelpGuide,
      openCopilot,
      closeCopilot,
      setContextCheckId,
      setDraft,
      clearDraft,
      clearHelpGuide,
    }),
    [open, draft, contextCheckId, showHelpGuide, openCopilot, closeCopilot, clearDraft, clearHelpGuide]
  );

  return <CopilotContext.Provider value={value}>{children}</CopilotContext.Provider>;
}

export function useCopilot() {
  const ctx = useContext(CopilotContext);
  if (!ctx) throw new Error("useCopilot must be used within CopilotProvider");
  return ctx;
}
