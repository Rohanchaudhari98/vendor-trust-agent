/** Context-aware follow-up questions after each Ask AI answer. */

export function nextQuestionSuggestions(input: {
  lastAssistant: string;
  lastUser?: string;
  contextCheckId: number | null;
  showingHelp?: boolean;
}): string[] {
  const text = `${input.lastUser ?? ""} ${input.lastAssistant}`.toLowerCase();
  const suggestions: string[] = [];

  if (input.showingHelp) {
    return [
      "Walk me through checking an invoice step by step.",
      "What should I do after I open a vendor report?",
      "Which invoices are still awaiting a pay or hold decision?",
    ];
  }

  if (input.contextCheckId != null) {
    suggestions.push(
      "Should I confirm hold or confirm payment based on this report?",
      "Summarize the internal records vs open-web evidence for this invoice.",
      "Re-check this payee live on the open web with Tavily"
    );
    return suggestions.slice(0, 3);
  }

  // Model asked for a vendor name before running a live Tavily check.
  if (/provide the name|payee you('|’)d like|vendor.?name|which (vendor|payee)/.test(text)) {
    return [
      "Look up Duluth Trading Company on the open web and tell me if it’s safe to pay",
      "Run a live check on FedEx Corporation at 942 South Shady Grove Road, Memphis, TN",
      "Check Procter & Gamble with remittance address 500 W Madison St, Chicago, IL",
    ];
  }

  if (/hold|held|discrepanc|mismatch|impersonat|do not pay/.test(text)) {
    suggestions.push(
      "Which invoices did we confirm as held, and why?",
      "Show checks with an approved-vendor details mismatch.",
      "What evidence usually leads to a Hold recommendation?"
    );
  } else if (/paid|ok to pay|clear|safe to pay|confirm payment/.test(text)) {
    suggestions.push(
      "Which invoices have we confirmed for payment, and why were they cleared?",
      "Any awaiting decisions that still look OK to pay?",
      "Look up Duluth Trading Company on the open web and tell me if it’s safe to pay"
    );
  } else if (/await|pending|decision|kpi|cost/.test(text)) {
    suggestions.push(
      "Which checks are still awaiting a pay or hold decision?",
      "Break down what's driving our Tavily + AI cost per check.",
      "Summarize our riskiest vendor checks so far."
    );
  } else {
    suggestions.push(
      "Which checks are still awaiting a pay or hold decision?",
      "What checks have flagged an internal vendor-master discrepancy?",
      "Look up Duluth Trading Company on the open web and tell me if it’s safe to pay"
    );
  }

  return suggestions.slice(0, 3);
}
