import type {
  CheckCreateRequest,
  CheckDetail,
  CheckSummary,
  ChatMessageOut,
  KPIResponse,
  ObservabilityResponse,
  VendorMasterRecord,
} from "./types";

// Empty string -> same-origin (production: backend/api.py serves the
// built frontend from the same process/port). Set VITE_API_BASE only if
// running the API on a different origin than the dev proxy handles.
const API_BASE = import.meta.env.VITE_API_BASE ?? "";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail ?? detail;
    } catch {
      // response body wasn't JSON -- fall back to statusText
    }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

export const api = {
  createCheck: (payload: CheckCreateRequest) =>
    request<CheckDetail>("/api/checks", { method: "POST", body: JSON.stringify(payload) }),

  /**
   * Live check with SSE progress events (internal → Tavily → Nebius → save).
   * Falls back to createCheck if streaming fails to start.
   */
  streamCreateCheck: async (
    payload: CheckCreateRequest,
    onEvent: (event: CheckStreamEvent) => void,
    signal?: AbortSignal
  ): Promise<CheckDetail> => {
    const res = await fetch(`${API_BASE}/api/checks/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    });
    if (!res.ok || !res.body) {
      // Fallback for older servers / proxies that don't support the stream route.
      return api.createCheck(payload);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let result: CheckDetail | null = null;
    let streamError: string | null = null;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split("\n\n");
      buffer = chunks.pop() ?? "";
      for (const raw of chunks) {
        const line = raw.trim();
        if (!line.startsWith("data:")) continue;
        const json = line.slice("data:".length).trim();
        if (!json) continue;
        try {
          const event = JSON.parse(json) as CheckStreamEvent;
          onEvent(event);
          if (event.type === "done") result = event.check;
          if (event.type === "error") streamError = event.message;
        } catch {
          // ignore partial JSON at chunk boundaries
        }
      }
    }

    if (streamError) throw new Error(streamError);
    if (!result) throw new Error("Vendor check finished without a report.");
    return result;
  },

  listChecks: (params: { tier?: string; source?: string; q?: string; limit?: number } = {}) => {
    const search = new URLSearchParams();
    if (params.tier) search.set("tier", params.tier);
    if (params.source) search.set("source", params.source);
    if (params.q) search.set("q", params.q);
    if (params.limit) search.set("limit", String(params.limit));
    const qs = search.toString();
    return request<CheckSummary[]>(`/api/checks${qs ? `?${qs}` : ""}`);
  },

  getCheck: (id: number) => request<CheckDetail>(`/api/checks/${id}`),

  recordDecision: (id: number, decision: "paid_simulated" | "held", note?: string) =>
    request<CheckDetail>(`/api/checks/${id}/decision`, {
      method: "POST",
      body: JSON.stringify({ decision, note: note ?? null }),
    }),

  getKPIs: (source?: string) =>
    request<KPIResponse>(`/api/kpis${source ? `?source=${encodeURIComponent(source)}` : ""}`),

  getObservability: () => request<ObservabilityResponse>("/api/observability"),

  listVendorMaster: () => request<VendorMasterRecord[]>("/api/vendor-master"),

  createVendorMaster: (payload: {
    vendor_name: string;
    known_address?: string | null;
    status?: "approved" | "watchlist" | "blocked";
    notes?: string | null;
    aliases?: string[];
  }) =>
    request<VendorMasterRecord>("/api/vendor-master", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  updateVendorMaster: (
    id: number,
    payload: {
      vendor_name?: string;
      known_address?: string | null;
      status?: "approved" | "watchlist" | "blocked";
      notes?: string | null;
      aliases?: string[];
    }
  ) =>
    request<VendorMasterRecord>(`/api/vendor-master/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),

  getCopilotHistory: (sessionId: string) =>
    request<ChatMessageOut[]>(`/api/copilot/history?session_id=${encodeURIComponent(sessionId)}`),

  clearCopilotHistory: (sessionId: string) =>
    request<{ deleted: number }>(
      `/api/copilot/history?session_id=${encodeURIComponent(sessionId)}`,
      { method: "DELETE" }
    ),
};

export type CopilotStreamEvent =
  | { type: "status"; message: string }
  | { type: "answer"; text: string; citations: import("./types").Citation[]; check_ids?: number[] }
  | { type: "error"; message: string };

export type CheckStreamEvent =
  | { type: "step"; id: string; label?: string; status: "running" | "done" }
  | { type: "done"; check: CheckDetail }
  | { type: "error"; message: string };

/**
 * Streams the copilot's SSE response via fetch + ReadableStream (not the
 * browser EventSource API, which cannot send a POST body) -- the
 * standard pattern for AI chat streaming over a request body.
 */
export async function streamCopilotChat(
  sessionId: string,
  message: string,
  onEvent: (event: CopilotStreamEvent) => void,
  signal?: AbortSignal,
  contextCheckId?: number | null
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/copilot/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      session_id: sessionId,
      message,
      ...(contextCheckId != null ? { context_check_id: contextCheckId } : {}),
    }),
    signal,
  });
  if (!res.ok || !res.body) {
    onEvent({ type: "error", message: `Copilot request failed (${res.status})` });
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";
    for (const raw of events) {
      const line = raw.trim();
      if (!line.startsWith("data:")) continue;
      const json = line.slice("data:".length).trim();
      if (!json) continue;
      try {
        onEvent(JSON.parse(json) as CopilotStreamEvent);
      } catch {
        // ignore malformed chunk boundary; next chunk read will complete it
      }
    }
  }
}
