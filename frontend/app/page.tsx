"use client";

import { useCopilotAction } from "@copilotkit/react-core";
import { useInterrupt } from "@copilotkit/react-core/v2";
import { CopilotChat } from "@copilotkit/react-ui";

import { ResearchCanvas } from "@/components/ResearchCanvas";
import { SearchCard } from "@/components/SearchCard";

// Shape of the interrupt payload emitted by approve_node (agent/agent.py).
type ApprovalPayload = {
  action: "approve_plan";
  plan: string[];
  message: string;
};

function parseApprovalPayload(value: unknown): ApprovalPayload | null {
  // The Python adapter JSON-serializes interrupt.value, so it usually
  // arrives as a string.
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const v = value as Record<string, unknown>;
  if (v.action !== "approve_plan") return null;
  if (!Array.isArray(v.plan)) return null;
  if (typeof v.message !== "string") return null;
  return {
    action: "approve_plan",
    plan: v.plan.filter((s): s is string => typeof s === "string"),
    message: v.message,
  };
}

export default function Home() {
  // Generative UI for the BACKEND search_web tool: `available: "disabled"`
  // registers a render-only tool-call renderer without adding a frontend
  // handler of the same name (which would collide with the backend tool).
  useCopilotAction({
    name: "search_web",
    description: "Search the web for information about a query.",
    available: "disabled",
    parameters: [{ name: "query", type: "string", required: true }],
    render: ({ args }) => <SearchCard query={args.query} />,
  });

  // Human-in-the-loop: renders in chat when the agent pauses on interrupt();
  // resolve(...) becomes interrupt()'s return value in approve_node.
  // agentId is required here: the v2 hook doesn't read the classic
  // <CopilotKit agent="..."> prop and would look for an agent named "default".
  useInterrupt({
    agentId: "research_agent",
    render: ({ event, resolve }) => {
      const payload = parseApprovalPayload(event.value);
      if (!payload) {
        console.error("[research] Unknown interrupt payload:", event.value);
        return (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 my-2">
            <p className="text-sm text-red-800">
              Received an unknown approval request — cancelling to unblock the
              agent.
            </p>
            <button
              onClick={() => resolve({ approved: false })}
              className="mt-2 px-3 py-1.5 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors"
            >
              Cancel
            </button>
          </div>
        );
      }

      return (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 my-2">
          <p className="text-sm font-semibold text-amber-800 mb-1">
            Approval required
          </p>
          <p className="text-sm text-amber-700 mb-3">{payload.message}</p>
          <ol className="text-sm text-amber-900 mb-3 space-y-1 list-decimal list-inside">
            {payload.plan.map((step, i) => (
              <li key={`${i}-${step}`}>{step}</li>
            ))}
          </ol>
          <div className="flex gap-2">
            <button
              onClick={() => resolve({ approved: true })}
              className="px-3 py-1.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-md transition-colors"
            >
              ✓ Approve &amp; research
            </button>
            <button
              onClick={() => resolve({ approved: false })}
              className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors"
            >
              Reject
            </button>
          </div>
        </div>
      );
    },
  });

  return (
    <main className="h-screen w-screen bg-slate-100 flex">
      <div className="flex-1 min-w-0">
        <ResearchCanvas />
      </div>
      <div className="w-[440px] shrink-0 h-screen border-l border-slate-200 bg-white flex flex-col">
        <div className="px-4 py-3 border-b border-slate-200">
          <h2 className="font-semibold text-slate-800">Research Assistant</h2>
        </div>
        <CopilotChat
          className="flex-1 min-h-0"
          labels={{
            initial:
              "👋 Hi! Give me any topic and I'll research it for you.\n\nFor example: *\"Research the history of coffee\"*\n\nI'll draft a plan and ask for your approval before digging in.",
          }}
        />
      </div>
    </main>
  );
}
