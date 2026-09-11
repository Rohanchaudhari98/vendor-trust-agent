/** How-to-use guide shown inside Ask AI — business navigation, not placeholder copy. */

export type HelpTopic = {
  title: string;
  body: string;
  askNext: string;
};

export const HELP_GUIDE_INTRO =
  "Here’s how to use Vendor Trust for pre-payment review. Pick a topic below, or ask in your own words.";

export const HELP_TOPICS: HelpTopic[] = [
  {
    title: "Check an invoice before payment",
    body: "On Home, click Check this invoice. Enter the payee name exactly as printed (and address if shown). We compare your approved-vendor list, search the open web with Tavily, then Nebius drafts a cited Pay / Hold / Review recommendation.",
    askNext: "Walk me through checking an invoice step by step.",
  },
  {
    title: "Read a report and confirm pay or hold",
    body: "Open any row on Home. Review the recommendation and evidence. When you’re ready, Confirm payment (recorded) or Confirm hold — that updates Home KPIs and invoice history so the team sees the outcome.",
    askNext: "What should I do after I open a vendor report?",
  },
  {
    title: "Understand Awaiting / Paid / Held",
    body: "Awaiting decision means research finished but no clerk has confirmed yet. Paid (recorded) means you approved payment in this tool (no bank transfer here). Held means do not pay until verified.",
    askNext: "Explain Awaiting decision vs Paid vs Held.",
  },
  {
    title: "Approved vendors list",
    body: "Open Admin → Approved vendors to add a payee or edit the address on file. The next invoice check on Home compares against the updated list immediately — no restart needed. Mismatched remittance details against that list are a common vendor-impersonation warning.",
    askNext: "How does the approved-vendor list affect a check?",
  },
  {
    title: "Ask about past checks or costs",
    body: "Use Ask AI anytime — including from a KPI card or report. Answers cite your history and sources. Costs & traces shows research spend and Langfuse links.",
    askNext: "Which invoices are still awaiting a pay or hold decision?",
  },
];

export function formatHelpGuideMessage(): string {
  const lines = [HELP_GUIDE_INTRO, ""];
  HELP_TOPICS.forEach((t, i) => {
    lines.push(`${i + 1}. ${t.title}`);
    lines.push(t.body);
    lines.push("");
  });
  lines.push("Ask a follow-up below, or tap a suggested question.");
  return lines.join("\n");
}
