// Mirrors backend/schemas.py -- kept in one file so every page imports
// the same shapes the API actually returns.

export type RiskTier = "clear" | "low" | "medium" | "high" | "needs_manual_review";

export type InternalMatchStatus =
  | "approved_match"
  | "approved_match_discrepancy"
  | "watchlist_match"
  | "blocked_match"
  | "no_match"
  | null;

export type CheckSource = "cli" | "web" | "copilot" | "eval" | "seed";

/** Human outcome that closes the AP loop (separate from risk recommendation). */
export type DecisionStatus = "pending" | "paid_simulated" | "held";

export interface Citation {
  claim: string;
  source_type: "web" | "internal";
  source_url: string | null;
  source_title: string;
}

export interface Signal {
  category: "legitimacy" | "adverse_media" | "entity_consistency" | "internal_records";
  finding: string;
  fraud_pattern: "vendor_impersonation" | "invoice_fraud" | "shell_company" | "none";
  citations: Citation[];
}

export interface CheckSummary {
  id: number | null;
  vendor_name: string;
  address: string | null;
  invoice_amount: number | null;
  risk_tier: RiskTier;
  evidence_count: number;
  internal_match_status: InternalMatchStatus;
  recommendation: string;
  cost_usd: number;
  latency_ms: number;
  source: CheckSource;
  created_at: string;
  decision_status: DecisionStatus;
  decision_note: string | null;
  decided_at: string | null;
}

export interface CheckDetail extends CheckSummary {
  signals: Signal[];
  search_credits: number;
  extract_credits: number;
  llm_input_tokens: number;
  llm_output_tokens: number;
  langfuse_trace_id: string | null;
  langfuse_trace_url: string | null;
}

export interface TierBreakdown {
  clear: number;
  low: number;
  medium: number;
  high: number;
  needs_manual_review: number;
}

export interface KPIResponse {
  total_checks: number;
  dollars_flagged: number;
  dollars_cleared: number;
  avg_cost_per_check: number;
  total_cost_usd: number;
  tier_breakdown: TierBreakdown;
  internal_discrepancy_count: number;
  awaiting_decision: number;
  paid_simulated: number;
  held: number;
}

export interface ObservabilityRow {
  id: number | null;
  vendor_name: string;
  source: CheckSource;
  cost_usd: number;
  search_credits: number;
  extract_credits: number;
  llm_input_tokens: number;
  llm_output_tokens: number;
  latency_ms: number;
  langfuse_trace_id: string | null;
  langfuse_trace_url: string | null;
  created_at: string;
}

export interface ObservabilityResponse {
  rows: ObservabilityRow[];
  aggregate: {
    total_checks: number;
    total_cost_usd: number;
    avg_latency_ms: number;
    avg_cost_usd: number;
  };
  /** Project home in Langfuse (from LANGFUSE_BASE_URL). */
  langfuse_url?: string | null;
}

export interface VendorMasterRecord {
  id: number | null;
  vendor_name: string;
  known_address: string | null;
  status: "approved" | "watchlist" | "blocked";
  notes: string | null;
  aliases: string[];
  created_at: string;
}

export interface ChatMessageOut {
  role: "user" | "assistant";
  content: string;
  citations: Citation[];
  created_at: string;
}

export interface CheckCreateRequest {
  vendor_name: string;
  address?: string | null;
  invoice_amount?: number | null;
}
