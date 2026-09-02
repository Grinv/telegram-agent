Verification note: several scenarios here assert that something is *blocked*. A blocked request proves nothing on its own — it can fail for unrelated reasons, which is how the first spike reached a wrong conclusion (see design.md — Risks). Every "is denied" task below is therefore paired with an "and succeeds once granted" step against the same target. Do not mark such a task done on the negative half alone.

## 1. Provisioning the boundary

- [ ] 1.1 Install the sandbox tooling (`brew install docker/tap/sbx`) and confirm the machine supports it. Verify: `sbx diagnose` reports virtualization supported.
- [ ] 1.2 Initialize the global network policy to deny-all (`sbx policy init deny-all`). Note that this is one-time and machine-global; `sbx policy reset` starts over. Verify: `sbx policy ls` shows a deny-all policy applying to all sandboxes.
- [ ] 1.3 Build a sandbox template image providing Node 24 or newer, so the boundary meets the project's declared `engines.node`. Verify: `node --version` inside a boundary created from the template reports 24.x or newer.
- [ ] 1.4 Create the boundary from that template, granting only the directories the agent needs, each with an explicit access mode, and record the exact command in `DEPLOYMENT.md`. Verify: the boundary is listed by `sbx ls` and the granted directories are present inside it.

## 2. Credentials

- [ ] 2.1 Store the Telegram bot token as a managed secret and bind it to `api.telegram.org`, instead of placing it in `.env`. Verify: the secret is listed by `sbx secret` and the binding names only that host.
- [ ] 2.2 Verify the token is genuinely absent inside the boundary: search the environment, the working tree, and any generated config for the token value (covers spec scenario "Credential is not readable from inside"). Verify: the value appears nowhere inside.
- [ ] 2.3 Verify the bot authenticates anyway, by starting it and confirming `getUpdates` succeeds rather than returning 401/404 (covers "Agent authenticates without holding the credential"). Verify: the polling loop runs without authentication errors.

## 3. LLM provider inside the boundary

- [ ] 3.1 Add the container registry hosts needed to pull the LLM provider image and model to the boundary's allow list, keeping the list to what is actually required. Verify: `docker pull` of the provider image succeeds inside the boundary.
- [ ] 3.2 Run the LLM provider on the boundary's own container runtime and pull the configured model into it. Verify: the provider's model list endpoint responds from inside the boundary with the model present.
- [ ] 3.3 Size the boundary's memory explicitly for the chosen model rather than relying on the default allocation (see design.md — Risks). Verify: the model loads and answers a trivial prompt without the boundary running out of memory.
- [ ] 3.4 Confirm inference traffic does not require any outbound grant, by removing the registry grants after the pull and checking the bot still gets answers (covers spec scenario "Bot reaches the LLM provider inside the boundary"). Verify: inference succeeds with no registry hosts in the allow list.

## 4. Running the agent

- [ ] 4.1 Establish the build-and-launch path: build on the host with Node 24 (`npm run build`) and start the compiled output inside the boundary (`node dist/index.js`), which needs no `node_modules` because the project declares no runtime dependencies. Add a script for it to `package.json`. Verify: the bot starts inside the boundary and logs `Bot starting`.
- [ ] 4.2 Confirm the agent runs unprivileged inside the boundary (covers "Agent runs unprivileged"). Verify: `id` inside reports a non-root user.
- [ ] 4.3 Confirm the per-tool-call sandbox still works inside the boundary by sending a message that triggers `execute_command`, and confirm no container appears on the host's runtime while it runs (covers "Tool sandboxes run inside the boundary" and "Tool sandboxes use the boundary's runtime"). Verify: the tool result is correct and `docker ps` on the host shows no sandbox container.

## 5. Network boundary verification

- [ ] 5.1 Paired check for "Unallowed host is refused" / "Allowed host is reachable": from inside the boundary, request a host absent from the allow list and confirm it fails; add it, confirm the same request succeeds; remove it again. Verify: the same request fails, then succeeds, then fails.
- [ ] 5.2 Paired check for "Host service is refused without a grant" / "Host service is reachable after a grant": run a service on the host bound to all interfaces, confirm it is refused from inside, then grant it as `localhost:<port>`, request it as `host.docker.internal:<port>`, and confirm it succeeds. Verify: the same request fails, then succeeds.
- [ ] 5.3 Check "A grant does not open other host ports": with one host port granted, run a second service on a different host port and confirm it is refused from inside. Verify: the ungranted port fails while the granted one still succeeds.
- [ ] 5.4 Check "Allow rules do not leak between boundaries": create a second boundary, and confirm a host allowed only for the first is refused from the second. Verify: the request fails in the second boundary.
- [ ] 5.5 Enumerate every rule actually in force for the boundary, including any contributed by the kit rather than added by hand (see design.md — Risks), and confirm each one is intended. Verify: `sbx policy ls` and `sbx policy inspect` show no rule the deployment did not ask for.

## 6. Filesystem boundary verification

- [ ] 6.1 Check "Granted directory is available": write a file from inside a read-write grant and confirm it appears on the host. Verify: the file exists on the host with the expected contents.
- [ ] 6.2 Check "Read-only grant cannot be written": attempt a write inside a read-only grant. Verify: the write fails and the host directory is unchanged.
- [ ] 6.3 Check "Ungranted directory is invisible": attempt to read a host directory that was not granted, such as the user's home directory. Verify: the read fails.
- [ ] 6.4 Check "Destroying the boundary leaves no residue": destroy the boundary and confirm no containers, images, or writable state from it remain on the host outside the granted read-write directories. Verify: the host's `docker ps -a` and `docker images` show nothing created by the agent.

## 7. Documentation

- [ ] 7.1 Document the isolated deployment in `DEPLOYMENT.md`: provisioning, the exact grants and allow rules, the secret binding, how to start and stop it, and how to fall back to the plain Docker deployment. Verify: the runbook can be followed start to finish on a clean machine.
- [ ] 7.2 Update `README.md` and `.env.example` to describe the token as a managed secret in the isolated deployment, while keeping the existing environment-file instructions for the plain deployment. Verify: both paths are documented and neither is presented as the only option.
- [ ] 7.3 Record in `DEPLOYMENT.md` the two rejected LLM-provider placements and what they cost (design.md — Decisions), so an operator hitting the memory limit knows the exits without rediscovering them. Verify: both alternatives are described with their trade-offs.

## 8. Final verification

- [ ] 8.1 Run `npm test` and `npx tsc --noEmit` on the host; both must pass, since this change touches no source under `src/`. Verify: `npm test` exits 0 and `tsc` reports no errors.
- [ ] 8.2 Confirm the plain Docker Compose deployment still works unchanged (covers "Host deployment still works"). Verify: `npm run docker:up` starts the stack and the bot replies to a message.
