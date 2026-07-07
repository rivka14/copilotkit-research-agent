import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { LangGraphHttpAgent } from "@copilotkit/runtime/langgraph";
import { NextRequest } from "next/server";

// The Python agent runs under uvicorn + ag-ui-langgraph, which speaks
// AG-UI over HTTP directly — hence LangGraphHttpAgent, not LangGraphAgent
// (the latter targets the LangGraph Platform / langgraph-cli dev protocol).
const runtime = new CopilotRuntime({
  agents: {
    research_agent: new LangGraphHttpAgent({
      url: process.env.AGENT_URL || "http://localhost:8000/",
    }),
  },
});

// No chat-completions fallback: the agent produces all responses, so the
// runtime only needs the empty adapter to satisfy its interface.
const serviceAdapter = new ExperimentalEmptyAdapter();

export const POST = async (req: NextRequest) => {
  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime,
    serviceAdapter,
    endpoint: "/api/copilotkit",
  });
  return handleRequest(req);
};
