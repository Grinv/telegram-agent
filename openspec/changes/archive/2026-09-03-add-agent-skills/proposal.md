## Why

The agent has tools but no instructions. Every message starts from nothing: the model is handed the user's text and a list of tool schemas, with no statement of what it is, what it is for, or how to accomplish anything domain-specific. There is not even a system message in the conversation contract — `ChatMessage` has `user`, `assistant`, and `tool` roles and nothing else.

That leaves two things impossible. The model cannot be told how to drive a specific command-line program or HTTP API correctly (which flags, which endpoint, how to read the output), and it cannot be given a named routine — a fixed sequence of steps to run when the user asks for it by name. Both are exactly the knowledge that does not fit in a tool description and would be wasteful to repeat in every user message.

## What Changes

- The conversation contract gains a system role, and every request the agent makes begins with a system message.
- Skills are introduced: Markdown files on disk, each carrying a name, a one-line description, and a body of instructions. They are authored content, loaded at startup, not written by the agent.
- The system message lists every available skill by name and description only — an index, not the contents.
- A new tool lets the model pull the full body of one named skill when it decides that skill is relevant.
- The system ships with at least one skill of each kind: one documenting how to drive a command-line program against a remote HTTP API, and one describing a multi-step routine that chains several actions into a single summarized answer.

Loading only the index up front, and a body only on request, is deliberate. Inlining every skill body into the system message would put the entire library into the context of every message, including messages that need none of it — the cost of which grows with each skill added.

## Capabilities

### New Capabilities

- `agent-skills`: authored Markdown instructions available to the agent — discovery at startup, the name/description index advertised to the model, on-demand retrieval of one skill's body, and the behaviour when a skill is malformed or missing.

### Modified Capabilities

- `llm-inference`: the connector contract gains a system role, so instructions can be carried as a conversation message rather than smuggled into the user's text.
- `bot-orchestrator`: each request the agent sends begins with a system message, which is not part of the conversation between the user and the agent.
- `sandbox-execution`: the tool execution context is extended so a tool can serve content the agent process loaded at startup, without reaching into the sandbox filesystem.

## Impact

- `src/llm/types.ts` — a system message variant on `ChatMessage`.
- `src/llms/ollama/index.ts` — maps the system role to the provider's wire format. **Sequencing: land `fix-ollama-message-mapping` first**; it rewrites the same two functions, and doing this one first would force that fix to be re-derived against changed code.
- `src/llms/stub/index.ts` — unaffected; it ignores conversation content.
- New `src/skills/` module — discovery, front-matter parsing, the in-memory library, and index rendering.
- New `src/tools/read-skill.ts` — the retrieval tool. It answers from the loaded library rather than from the sandbox, because skill files live in the agent's own working tree and are not present inside a sandbox container.
- `src/tools/types.ts`, `src/tools/index.ts`, `src/sandbox/sandbox-executor.ts`, `src/index.ts` — plumbing the loaded library to the tool.
- `src/orchestrator.ts` — prepends the system message when building each request.
- New `skills/` directory at the repository root, holding the shipped skill files.
- `src/config.ts`, `.env.example`, `README.md` — the skills directory location and the new tool.
- The command-line-API skill needs outbound network and an HTTP client in the sandbox: it is only runnable once `add-sandbox-egress` has landed and egress mode is enabled. The skill itself, its discovery, and its retrieval do not depend on that.
