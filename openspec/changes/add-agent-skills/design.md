## Context

See proposal.md — Why. The constraints that shape the approach:

- `ChatMessage` in `src/llm/types.ts` is a union of `user`, `assistant`, and `tool`. There is no system role anywhere in the codebase, and `src/orchestrator.ts` builds each request's message list from the user's text alone.
- The project deliberately avoids third-party libraries where a Node built-in will do (`openspec/config.yaml` — context). There is no YAML parser available, and adding one for front matter would be the project's first runtime dependency.
- A sandbox container has a read-only root, an empty tmpfs workdir, and no host mounts (`src/sandbox/sandbox-executor.ts`). Nothing from the repository — including skill files — is visible inside it.
- `spawn_subagent` already establishes the pattern of a tool that ignores `execInContainer` and works entirely from other context fields, so a tool that never touches the sandbox is not a new idea here.

## Goals / Non-Goals

**Goals:**
- Let authored instructions reach the model without spending context on instructions it does not need.
- Keep skills authored content: read at startup, never written by the agent.
- Fail soft on bad input — one broken skill file must not stop the bot.

**Non-Goals:**
- Letting the agent create, edit, or delete skills.
- Reloading skills without a restart. Discovery happens once; changing a skill means restarting, which matches how models are discovered today.
- Nested or composed skills, or skills that declare dependencies on each other.
- Per-skill tool permissions. A skill is instructions, not a capability grant.

## Decisions

**The index goes in the system message; bodies come from a tool.** The alternative — inlining every body into the system message — is simpler and wrong: it puts the whole library into every request, including the ones needing none of it, and the cost grows with each skill added. The index is a few dozen tokens per skill; a body is hundreds to thousands. Since the system message is re-sent on every iteration of the loop, that difference is multiplied by turn count, not paid once.

This makes the skill index the one part of the prompt that is both constant and always present, which matters later: the token-optimization work depends on a stable prefix for cache reuse, and a system message assembled the same way every time is exactly that. Keep it deterministic — no timestamps, no per-message interpolation, no reordering.

**Front matter is parsed with a purpose-built reader, not a YAML parser.** Only two scalar keys are needed (`name`, `description`). A hand-written reader for `--- ... ---` delimited `key: value` lines is a few lines of code and no dependency; a YAML parser would be the project's first runtime dependency, pulled in for two strings. The reader must be strict about what it does not support: anything beyond simple scalars is a malformed file, not a silently ignored one.

**A malformed skill is skipped and reported, never fatal.** Skills are content, and content is where typos happen. A file missing its description means one skill is unavailable; it must not stop a bot from starting. This mirrors how the existing model discovery treats an unreachable Ollama — logged, degraded, not fatal.

**Skills are loaded into the agent process, and the retrieval tool answers from memory.** The skill files live in the repository and are not present in any sandbox, so a tool that shelled out to read them would fail. Two alternatives were considered: mounting the skills directory into each sandbox (reintroduces a host mount into a container that deliberately has none, for content the agent process has already read) and reading from the host filesystem inside the tool handler (file I/O per tool call, and a second source of truth that can disagree with the index in the system message). Serving from the same in-memory library that produced the index guarantees the two cannot diverge.

**An unknown skill name returns a failed tool result listing the valid names.** The model picks the name from the index, so a miss means it hallucinated or mistyped. Returning the available names lets it correct itself on the next iteration; returning a bare error invites a blind retry, which costs a whole turn.

**The system message is not conversation.** It is generated per request and never persisted, shown, or replayed. This matters for the chat-history work that follows: history holds what the user and the agent said, and the instructions are reassembled from current configuration each time. Persisting them would freeze a stale skill index into a conversation.

## Risks / Trade-offs

**A skill body may be large enough to hurt on its own** → Retrieval is a tool result, so a long skill enters the conversation and is re-sent on every subsequent iteration of that loop. The mitigation is editorial rather than technical: skills are authored, so keep them short. If this becomes a real cost, it is a case for the tool-output truncation planned in the token-optimization work, not a reason to complicate retrieval now.

**The model may ignore the index and never retrieve anything** → Nothing forces a retrieval; the index only advertises. Whether the model uses it depends on how the index is worded and on the model's tool-calling ability. This is worth testing against the actual configured model early rather than assuming it works, which is why the shipped skills carry end-to-end verification tasks rather than only unit tests.

**Two sources of instruction can drift** → The system message names what the agent is, and each skill body says how to do one thing. If a skill contradicts the base instructions, behaviour depends on the model. Keeping the base instructions short and factual limits the surface for contradiction.

**Skill content is trusted input** → Skill bodies are injected into the model's context as instructions. Anyone who can write to the skills directory can steer the agent. This is the same trust level as the source code, which is why skills are authored files in the repository rather than something the agent or a user can supply at runtime.
