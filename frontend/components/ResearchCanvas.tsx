"use client";

import { useCoAgent } from "@copilotkit/react-core";

// Mirror of the agent-side ResearchState (agent/agent.py) — only the fields
// the UI consumes. Keep names and types in sync with the Python side.
export type AgentState = {
  topic: string;
  plan: string[];
  status: string;
  findings: string;
  summary: string;
};

const STATUS_LABELS: Record<string, string> = {
  planning: "Drafting a research plan…",
  planned: "Plan ready",
  awaiting_approval: "Waiting for your approval",
  approved: "Plan approved",
  rejected: "Plan declined",
  researching: "Researching…",
  researched: "Research complete",
  summarizing: "Writing summary…",
  done: "Done",
  error: "Failed — try again",
};

// Which pipeline stage each status belongs to, for the step indicator.
const STAGE_OF_STATUS: Record<string, number> = {
  planning: 0,
  planned: 0,
  awaiting_approval: 1,
  approved: 1,
  rejected: 1,
  researching: 2,
  researched: 2,
  summarizing: 3,
  done: 4,
};

const STAGES = ["Plan", "Approve", "Research", "Summarize"];

export function ResearchCanvas() {
  const { state } = useCoAgent<AgentState>({
    name: "research_agent",
    initialState: {
      topic: "",
      plan: [],
      status: "",
      findings: "",
      summary: "",
    },
  });

  // State can be briefly undefined while syncing — default everything.
  const topic = state?.topic ?? "";
  const plan = state?.plan ?? [];
  const status = state?.status ?? "";
  const findings = state?.findings ?? "";
  const summary = state?.summary ?? "";

  const stage = STAGE_OF_STATUS[status] ?? -1;
  const isError = status === "error" || status === "rejected";
  const running = status !== "" && status !== "done" && !isError;

  if (!topic && !status) {
    return (
      <div className="h-screen flex items-center justify-center">
        <div className="max-w-xl text-center px-6">
          <h1 className="text-3xl font-bold text-slate-800 mb-3">
            Research Assistant
          </h1>
          <p className="text-slate-500">
            Ask the assistant in the sidebar to research any topic. Its plan,
            progress, and findings will appear here in real time.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-full p-6">
      <div className="bg-white rounded-2xl shadow-lg p-10 h-full w-full overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-slate-800 capitalize">
            {topic || "…"}
          </h1>
          {status && (
            <span
              className={`text-xs font-medium px-3 py-1 rounded-full ${
                running
                  ? "bg-indigo-100 text-indigo-700 animate-pulse"
                  : isError
                    ? "bg-red-100 text-red-700"
                    : "bg-green-100 text-green-700"
              }`}
            >
              {STATUS_LABELS[status] ?? status}
            </span>
          )}
        </div>

        {/* Pipeline stage indicator */}
        <div className="flex items-center gap-2 mb-8">
          {STAGES.map((label, i) => (
            <div key={label} className="flex items-center gap-2 flex-1">
              <div
                className={`h-7 w-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                  stage > i
                    ? "bg-green-500 text-white"
                    : stage === i
                      ? "bg-indigo-500 text-white animate-pulse"
                      : "bg-slate-200 text-slate-500"
                }`}
              >
                {stage > i ? "✓" : i + 1}
              </div>
              <span
                className={`text-sm ${
                  stage >= i ? "text-slate-800 font-medium" : "text-slate-400"
                }`}
              >
                {label}
              </span>
              {i < STAGES.length - 1 && (
                <div className="flex-1 h-px bg-slate-200" />
              )}
            </div>
          ))}
        </div>

        <div className="grid gap-x-10 lg:grid-cols-2">
          <div>
            {plan.length > 0 && (
              <section className="mb-6">
                <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">
                  Research Plan
                </h2>
                <ol className="space-y-2">
                  {plan.map((step, i) => (
                    <li
                      key={`${i}-${step}`}
                      className="flex gap-3 text-slate-700 text-sm bg-slate-50 rounded-lg p-3"
                    >
                      <span className="font-bold text-indigo-500">{i + 1}.</span>
                      {step}
                    </li>
                  ))}
                </ol>
              </section>
            )}

            {summary && (
              <section className="mb-6">
                <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">
                  Summary
                </h2>
                <div className="text-sm text-slate-700 bg-indigo-50 border border-indigo-100 rounded-lg p-4 whitespace-pre-wrap">
                  {summary}
                </div>
              </section>
            )}
          </div>

          <div>
            {findings && (
              <section className="mb-6">
                <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">
                  Findings
                </h2>
                <div className="text-sm text-slate-600 bg-slate-50 rounded-lg p-4 whitespace-pre-wrap">
                  {findings}
                </div>
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
