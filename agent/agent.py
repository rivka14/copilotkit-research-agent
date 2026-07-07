import logging
import os
from typing import List

from google.genai import errors as genai_errors
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage
from langchain_core.runnables import RunnableConfig
from langchain_core.tools import tool
from langchain_google_genai import ChatGoogleGenerativeAI
from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, StateGraph
from langgraph.types import interrupt

from langchain_core.callbacks import adispatch_custom_event

from copilotkit import CopilotKitState
from copilotkit.langgraph import copilotkit_emit_state

logger = logging.getLogger("research_agent")

# Free-tier Gemini quota is 20 requests/day PER MODEL NAME and a research run
# costs ~5-6 requests. The "-latest" aliases draw from separate quota buckets
# than the pinned names, so hopping between gemini-flash-lite-latest,
# gemini-flash-latest, gemini-2.5-flash-lite, ... via GEMINI_MODEL buys extra
# runs on the same key.
MODEL = os.getenv("GEMINI_MODEL", "gemini-flash-lite-latest")

def _retrying(runnable):
    """Retry only transient 5xx (Gemini intermittently 503s under load).

    Quota errors (429, raised wrapped in ChatGoogleGenerativeAIError) must NOT
    be retried — backoff just hangs the run for minutes without helping.
    """
    return runnable.with_retry(
        retry_if_exception_type=(genai_errors.ServerError,),
        stop_after_attempt=3,
    )


llm = ChatGoogleGenerativeAI(model=MODEL, temperature=0)
llm_retrying = _retrying(llm)


class ResearchState(CopilotKitState):
    topic: str
    plan: List[str]
    status: str
    findings: str
    summary: str


@tool
def search_web(query: str) -> str:
    """Search the web for information about a query."""
    # Mock search — the POC has no real search backend, so the LLM answers
    # from its own knowledge; the tool exists to demo generative UI in chat.
    return (
        f"Top results for '{query}':\n"
        f"1. Overview article covering the key facts about {query}.\n"
        f"2. Historical timeline with dates and milestones related to {query}.\n"
        f"3. Recent analysis discussing trends and open questions around {query}."
    )


def _text(content) -> str:
    """Normalize message content: newer Gemini models (e.g. gemini-3-*) return
    a list of content parts instead of a plain string."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(
            part.get("text", "") if isinstance(part, dict) else str(part)
            for part in content
        )
    return str(content)


def _silent_config(config: RunnableConfig) -> RunnableConfig:
    """Suppress chat streaming for an LLM call at BOTH SDK layers.

    copilotkit_customize_config only sets 'copilotkit:emit-messages', which the
    CopilotKit subclass uses to filter events off the wire — but the base
    ag-ui-langgraph adapter reads a different key ('emit-messages') and still
    does message bookkeeping. A filtered TEXT_MESSAGE_END then never clears the
    adapter's in-progress record, and the NEXT streaming node emits
    TEXT_MESSAGE_CONTENT with the stale id → the runtime kills the stream
    ("No active text message found"). Setting the base key too keeps the base
    adapter fully silent so no stale record is ever created.
    """
    # Built by hand instead of via copilotkit_customize_config: that helper
    # MUTATES the passed config's metadata dict in place, which would taint
    # the node's own `config` — and the manually emitted tool-call events
    # (dispatched with `config`) would then be filtered out too.
    return {
        **config,
        "metadata": {
            **(config.get("metadata") or {}),
            "copilotkit:emit-messages": False,
            "copilotkit:emit-tool-calls": False,
            "emit-messages": False,
            "emit-tool-calls": False,
        },
    }


def _snapshot(state: ResearchState, **updates) -> dict:
    """Full canvas state for intermediate emission — partial dicts would
    momentarily blank out fields the frontend is already rendering."""
    snap = {
        "topic": state.get("topic", ""),
        "plan": state.get("plan", []),
        "status": state.get("status", ""),
        "findings": state.get("findings", ""),
        "summary": state.get("summary", ""),
    }
    snap.update(updates)
    return snap


async def _fail(state: ResearchState, config: RunnableConfig, exc: Exception) -> dict:
    """Turn an exception into a graceful end of the run: an uncaught error
    kills the AG-UI event stream and the frontend only sees a dead socket."""
    logger.exception("Research run failed")
    await copilotkit_emit_state(config, _snapshot(state, status="error"))

    if "RESOURCE_EXHAUSTED" in str(exc):
        hint = (
            f"⚠️ The Gemini free-tier quota for `{MODEL}` is exhausted. "
            "Try again later, or set GEMINI_MODEL in agent/.env to a model "
            "with remaining quota."
        )
    else:
        detail = str(exc).strip().splitlines()[0][:200] if str(exc).strip() else ""
        hint = (
            f"⚠️ I hit an error while working on this ({exc.__class__.__name__}"
            f"{': ' + detail if detail else ''}). Please try again in a moment."
        )

    return {"status": "error", "messages": [AIMessage(content=hint)]}


async def plan_node(state: ResearchState, config: RunnableConfig) -> dict:
    topic = str(state["messages"][-1].content)
    await copilotkit_emit_state(
        config,
        _snapshot(state, status="planning", topic=topic, plan=[], findings="", summary=""),
    )

    # Silence message streaming: the raw 3-line output is not chat-worthy;
    # we return a formatted AIMessage below instead.
    silent = _silent_config(config)
    try:
        response = await llm_retrying.ainvoke(
            [
                SystemMessage(
                    content=(
                        "You are a research planner. "
                        "List exactly 3 concise research steps, one per line, "
                        "no numbering or bullets."
                    )
                ),
                HumanMessage(content=f"Topic: {topic}"),
            ],
            silent,
        )
    except Exception as exc:  # noqa: BLE001 — any failure should end the run gracefully
        return await _fail(state, config, exc)

    content = _text(response.content)
    plan = [line.strip() for line in content.strip().splitlines() if line.strip()][:3]

    plan_list = "\n".join(f"{i + 1}. {step}" for i, step in enumerate(plan))
    return {
        "topic": topic,
        "plan": plan,
        "status": "planned",
        "findings": "",
        "summary": "",
        "messages": [
            AIMessage(content=f"Here's my research plan for **{topic}**:\n\n{plan_list}")
        ],
    }


async def approve_node(state: ResearchState, config: RunnableConfig) -> dict:
    await copilotkit_emit_state(config, _snapshot(state, status="awaiting_approval"))

    # Pauses the graph and surfaces the payload to the frontend (useInterrupt).
    # Requires the checkpointer; on resume the node re-executes from the top
    # and interrupt() returns the value passed to resolve() in the UI.
    answer = interrupt(
        {
            "action": "approve_plan",
            "plan": state.get("plan", []),
            "message": (
                f"Do you want me to proceed with this research plan for "
                f"\"{state.get('topic', '')}\"?"
            ),
        }
    )

    approved = answer.get("approved") if isinstance(answer, dict) else bool(answer)
    if not approved:
        await copilotkit_emit_state(config, _snapshot(state, status="rejected"))
        return {
            "status": "rejected",
            "messages": [
                AIMessage(
                    content=(
                        "No problem — I've put the plan on hold. Tell me what to "
                        "change, or give me a different topic."
                    )
                )
            ],
        }

    return {"status": "approved"}


async def research_node(state: ResearchState, config: RunnableConfig) -> dict:
    await copilotkit_emit_state(config, _snapshot(state, status="researching"))

    # Fully silent: langchain-google-genai streams tool calls in
    # additional_kwargs.function_call, which ag-ui-langgraph doesn't read
    # (it only looks at tool_call_chunks) — so streamed tool-call events
    # never fire with Gemini. We emit them manually in the loop below.
    research_config = _silent_config(config)

    llm_with_tools = _retrying(llm.bind_tools([search_web]))
    steps = "\n".join(f"- {s}" for s in state.get("plan", []))
    messages: list = [
        SystemMessage(
            content=(
                "You are a thorough researcher. Investigate the topic following the given steps. "
                "Use the search_web tool once per step to gather information, then write up "
                "detailed findings."
            )
        ),
        HumanMessage(content=f"Topic: {state['topic']}\n\nResearch steps:\n{steps}"),
    ]

    try:
        response = await llm_with_tools.ainvoke(messages, research_config)
        while response.tool_calls:
            messages.append(response)
            for tool_call in response.tool_calls:
                # Emit the tool call so the frontend renders a SearchCard.
                # Two upstream bugs force this exact form: (1) the adapter only
                # reads tool_call_chunks from streamed chunks, which
                # langchain-google-genai leaves empty, so Gemini tool calls
                # never stream; (2) copilotkit_emit_tool_call dispatches a
                # "copilotkit_manually_emit_tool_call" event whose handler
                # builds the TOOL_CALL events but never yields them. The base
                # adapter's own "manually_emit_tool_call" event works — and
                # must be dispatched with the unfiltered `config`, not
                # research_config, or the emit-tool-calls filter eats it.
                await adispatch_custom_event(
                    "manually_emit_tool_call",
                    {
                        "id": tool_call.get("id") or f"tc-{len(messages)}",
                        "name": tool_call["name"],
                        "args": tool_call["args"],
                    },
                    config=config,
                )
                result = search_web.invoke(tool_call["args"])
                messages.append(ToolMessage(content=result, tool_call_id=tool_call["id"]))
            response = await llm_with_tools.ainvoke(messages, research_config)
    except Exception as exc:  # noqa: BLE001
        return await _fail(state, config, exc)

    return {"findings": _text(response.content), "status": "researched"}


async def summarize_node(state: ResearchState, config: RunnableConfig) -> dict:
    await copilotkit_emit_state(config, _snapshot(state, status="summarizing"))

    # Streams into chat by default — the summary is the chat-facing result.
    try:
        response = await llm_retrying.ainvoke(
            [
                SystemMessage(
                    content=(
                        "You are a summarizer. Write exactly 3 bullet points (using •) as a "
                        "concise, actionable summary of the findings."
                    )
                ),
                HumanMessage(content=f"Findings:\n{state['findings']}"),
            ],
            config,
        )
    except Exception as exc:  # noqa: BLE001
        return await _fail(state, config, exc)

    summary = _text(response.content)
    # Same id as the streamed message so the end-of-run snapshot replaces the
    # streamed bubble instead of duplicating it.
    return {
        "summary": summary,
        "status": "done",
        "messages": [AIMessage(content=summary, id=response.id)],
    }


def _unless_stopped(next_node: str):
    """Router: skip the rest of the pipeline after an error or a rejection."""

    def route(state: ResearchState) -> str:
        return END if state.get("status") in ("error", "rejected") else next_node

    return route


def build_graph():
    workflow = StateGraph(ResearchState)

    workflow.add_node("plan", plan_node)
    workflow.add_node("approve", approve_node)
    workflow.add_node("research", research_node)
    workflow.add_node("summarize", summarize_node)

    workflow.set_entry_point("plan")
    workflow.add_conditional_edges("plan", _unless_stopped("approve"), ["approve", END])
    workflow.add_conditional_edges("approve", _unless_stopped("research"), ["research", END])
    workflow.add_conditional_edges("research", _unless_stopped("summarize"), ["summarize", END])
    workflow.add_edge("summarize", END)

    return workflow.compile(checkpointer=MemorySaver())


graph = build_graph()
