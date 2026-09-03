Sequencing note: land `fix-ollama-message-mapping` before starting task 2. Both rewrite `buildMessages()`/`toOllamaMessage()` in `src/llms/ollama/index.ts`, and doing this change first would force that fix to be re-derived against changed code.

## 1. Skill library module

- [x] 1.1 Create `src/skills/types.ts` with a `Skill` type (`name`, `description`, `body`) and a `SkillLibrary` interface exposing the loaded skills, a lookup by name, and the rendered index. Verify: `npx tsc --noEmit` passes.
- [x] 1.2 Create `src/skills/front-matter.ts` with a pure function that takes a file's text and returns its `name`/`description` plus the body, or a typed failure naming what was missing. Support only `---`-delimited simple `key: value` scalars; anything else is a failure, not a silent skip (see design.md — Decisions). Verify: `npx tsc --noEmit` passes.
- [x] 1.3 Unit-test the front-matter reader in `test/skills/front-matter.test.ts`: well-formed input yields name, description and body; missing `name` fails; missing `description` fails; absent front matter fails; body content containing `---` is not truncated. Verify: `npm test` passes.
- [x] 1.4 Create `src/skills/index.ts` with `loadSkills(dir: string): SkillLibrary`, reading `*.md` from the directory, parsing each, skipping and logging malformed files, and resolving name collisions by keeping one and logging the collision. Verify: `npx tsc --noEmit` passes.
- [x] 1.5 Unit-test loading in `test/skills/index.test.ts` against fixture directories: three well-formed files all load (covers "Directory with several skills"); a non-existent directory yields an empty library without throwing (covers "Skills directory is absent"); an empty directory yields an empty library (covers "Skills directory is empty"). Verify: `npm test` passes.
- [x] 1.6 Unit-test the failure paths: a directory with two valid files and one missing its description loads two skills and logs the offending filename (covers "One file is missing its description"); two files declaring the same name yield exactly one skill of that name and a logged collision (covers "Two skills declare the same name"). Verify: `npm test` passes.
- [x] 1.7 Unit-test index rendering: the rendered index contains every skill's name and description and none of their bodies (covers "Index lists names and descriptions only"). Verify: `npm test` passes.

## 2. System message support

- [x] 2.1 Add a `SystemMessage` variant (`role: 'system'`, `content: string`) to `ChatMessage` in `src/llm/types.ts`. Verify: `npx tsc --noEmit` passes, and existing exhaustive switches over `ChatMessage` fail to compile until handled — fix each.
- [x] 2.2 Map the system role in `src/llms/ollama/index.ts`'s `toOllamaMessage()` to the provider's `system` role. Verify: `npx tsc --noEmit` passes.
- [x] 2.3 Test in `test/llms/ollama.test.ts` with a fake `fetch` that a request whose messages begin with a system message sends it to the provider as a `system`-role message, distinct from the user turn (covers "Request carries a system instruction"). Verify: `npm test` passes.
- [x] 2.4 Test that a request with no system message produces the same wire payload as before this change (covers "Request carries no system instruction"). Verify: `npm test` passes.
- [x] 2.5 Test in `test/llms/stub.test.ts` that the stub connector returns a successful result for a request carrying a system message rather than rejecting it (covers "Connector without system-instruction support"). Verify: `npm test` passes.

## 3. Prompt assembly

- [x] 3.1 Add a pure function that builds the system instruction text from the base instructions plus the skill index, omitting the skill section entirely when the library is empty (covers "No skills available"). Keep it deterministic — no timestamps or per-message interpolation, since a stable prefix is relied on later (see design.md — Decisions). Verify: `npx tsc --noEmit` passes.
- [x] 3.2 Unit-test that function: with skills, the output names each one; with an empty library, the output contains no skill section and no placeholder. Verify: `npm test` passes.
- [x] 3.3 Unit-test that calling it twice with the same library returns byte-identical text. Verify: `npm test` passes.

## 4. read_skill tool

- [x] 4.1 Create `src/tools/read-skill.ts` exporting a `read_skill` tool that takes a skill name and returns that skill's body from the library carried on the tool execution context, without calling `execInContainer`. Verify: `npx tsc --noEmit` passes.
- [x] 4.2 Extend the tool execution context in `src/tools/types.ts` with an optional skill library, and register `read_skill` in `src/tools/index.ts` only when a library is present. Verify: `npx tsc --noEmit` passes.
- [x] 4.3 Unit-test in `test/tools/read-skill.test.ts` that requesting a loaded skill returns its full body (covers "Model retrieves a known skill"). Verify: `npm test` passes.
- [x] 4.4 Unit-test that requesting an unknown name returns a failed result naming the request and listing the available names (covers "Model requests an unknown skill"). Verify: `npm test` passes.
- [x] 4.5 Unit-test that the tool succeeds with a context whose `execInContainer` throws if called, proving it never touches the sandbox (covers "Retrieval does not require the sandbox filesystem" and the sandbox-execution scenario "A tool answers from the agent process without touching the sandbox"). Verify: `npm test` passes.
- [x] 4.6 Confirm existing tools are unaffected by the context gaining a field, by running the existing tool tests unchanged (covers "Existing tools continue to work when ToolContext is extended"). Verify: `npm test` passes.

## 5. Orchestrator integration

- [x] 5.1 In `src/orchestrator.ts`, prepend the system message to the message list built for each incoming message, and ensure it remains present on follow-up iterations of the loop. Verify: `npx tsc --noEmit` passes.
- [x] 5.2 Test in `test/orchestrator.test.ts` with a fake `callLlm` that the first request's messages begin with a system message (covers "First request of a message"). Verify: `npm test` passes.
- [x] 5.3 Test that after a tool call, the follow-up request also begins with the system message (covers "Later iterations of the same loop"). Verify: `npm test` passes.
- [x] 5.4 Test that the reply sent to the chat contains no part of the system instruction (covers "Instruction is not conversation"). Verify: `npm test` passes.

## 6. Configuration and wiring

- [x] 6.1 Add `resolveSkillsDir(raw: string | undefined): string` to `src/config.ts` (env `SKILLS_DIR`, default `skills`), add it to `AppConfig` and `loadConfig()`, and unit-test the default and an override in `test/config.test.ts`. Verify: `npm test` passes.
- [x] 6.2 In `src/index.ts`, load the skill library at startup, log how many skills loaded (and the directory's absence, if absent), pass the library into the tool context and into prompt assembly. Verify: `npm run dev` logs the loaded skill count at startup.

## 7. Shipped skills

- [x] 7.1 Write `skills/weather.md` — the command-line-API skill: which command to run against `https://wttr.in`, which parameters to use, and how to read the output. Verify: the file loads and appears in the rendered index.
- [x] 7.2 Write `skills/morning-briefing.md` — the routine skill: at least three ordered steps ending in one summary for the user, using only capabilities the sandbox actually has. Verify: the file loads and appears in the rendered index.
- [x] 7.3 End-to-end check of the command-line-API skill: with sandbox network egress enabled (`add-sandbox-egress`) and the sandbox image carrying an HTTP client, ask the bot a question the skill covers and confirm it retrieves the skill, runs the command, and answers from the output (covers "Agent answers using the documented command"). Verify: the reply contains fetched live data.
- [x] 7.4 End-to-end check of the routine skill: ask for the routine and confirm the agent performs the documented steps in order and replies with a single summary rather than raw per-step output (covers "Agent runs the routine end to end"). Verify: the reply is one summary covering every step.
- [x] 7.5 Confirm the model actually uses the index rather than ignoring it (see design.md — Risks): with the configured model, check across a few messages that it retrieves a skill when one is relevant and does not retrieve one when none is. If it never retrieves, reword the index before proceeding rather than treating the feature as done. Verify: retrieval happens on relevant messages and not on irrelevant ones.

## 8. Documentation

- [x] 8.1 Document `SKILLS_DIR` in `.env.example` and add a README section covering what a skill file looks like, the two shipped skills, that the index is advertised while bodies are fetched on demand, and that skills are authored files the agent cannot modify. Verify: README describes the file format and both shipped skills.

## 9. Final verification

- [x] 9.1 Run `npm test` and `npx tsc --noEmit`; both must pass with no new failures. Verify: `npm test` exits 0 and `tsc` reports no errors.
