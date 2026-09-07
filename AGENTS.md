# Session Workflow

## Default: Delegate to Sub-Agents

- In every session, delegate suitable research, implementation, testing, and review to sub-agents by default.
- The main agent owns scoping, coordination, user communication, and review of delegated results, and remains accountable for correctness and completion. Step in directly only when delegation is unavailable or unsuitable, or intervention is necessary.
- Run independent tasks in parallel with clear task and file ownership. Avoid concurrent same-file edits and duplicated work.
- Do not assume knowledge of agents running in other terminals or promise that delegation frees shared capacity.
- All sub-agents must follow the existing Git, worktree, safety, verification, and approval safeguards. Delegation does not authorize automatic worktrees, commits, merges, or pushes.

## Default: Work Directly on Main

- By default, use the primary `Cicerosstrase` checkout on `main` directly. Do not create a worktree, feature branch, or isolated preview unless the user explicitly requests a worktree for the session. Feature size alone does not enable isolation. The user does not need to say `ignore worktree`; that phrase also selects this default mode.
- The isolation and isolated-preview sections below apply only to explicitly requested worktree sessions. Safety, verification, and approval requirements apply in both modes.
- Inspect the branch, status, and worktrees before editing. If the primary checkout is not on `main`, ask before proceeding. If this session already has a feature worktree with changes, ask how to handle those changes rather than silently moving or discarding them.
- Before application changes, update a clean `main` with `git pull --ff-only`. If the checkout is dirty or the pull fails, report the blocker and ask before proceeding. Never stash, discard, or overwrite unrelated work to enable this mode.
- Make edits and run relevant checks directly in the primary checkout. Reuse the user's main development server when running; no separate preview is required. Preserve that server and verify and report its URL for application changes.
- Wait for the user to say "done", "finished", "merge", or explicitly request integration. Then review and commit only this session's changes directly on `main`, run the required verification, and push `main` to its configured upstream without a separate push confirmation. No feature merge is needed. Review all outgoing commits and ask before publishing unfamiliar work; retain all existing commit, verification, and push safeguards below.
- If the user rejects the session with "remove" or "delete", undo only this session's uncommitted changes after checking for overlapping edits. Never remove the primary checkout or delete `main`; ask before reverting already committed or pushed changes.

## Keep the Main Folder on Main

- The primary `Cicerosstrase` project folder is the permanent checkout of `main`. Keep it on `main` so the user's existing development server, normally at `http://127.0.0.1:5173`, always serves the latest locally merged application.
- Feature branches live in temporary sibling worktrees, not in the primary folder. These are isolated working copies of the same repository, not separate projects. Do not switch the primary folder to a feature branch.
- Merge approved sessions directly into `main` in the primary folder so its files and running Vite server receive the changes. Do not merge elsewhere and leave the primary folder serving an older branch.
- Preserve the user's main development server across sessions and feature cleanup. After merging, verify it serves the updated files if running, and report its URL. Vite normally reloads automatically; if dependency or configuration changes require a restart or install, explain that and coordinate rather than stopping the user's server silently.
- If the primary folder is unexpectedly on another branch or `main` is checked out elsewhere, inspect the state and ask before relocating checkouts. Never discard local changes to enforce this layout.

## Isolate Only on Request

- Treat a task prefixed with `work tree` (case-insensitive), such as `work tree: redesign the room pages`, as an explicit request to use an isolated worktree for that task. No additional confirmation of isolation is needed; the safety checks below still apply. Without this prefix or another explicit worktree request, work directly on `main`.
- Only when the user explicitly requests a worktree, create a dedicated Git worktree and a uniquely named branch before editing application files. In this mode, never develop in the shared checkout or reuse another session's branch. A discussion of worktrees alone is not a request to create one.
- Inspect `git status`, `git worktree list`, and existing branches first. Preserve all existing changes, worktrees, and running servers belonging to the user or other sessions.
- Default to branching from local `main`. If the task needs unmerged work from another branch, confirm the intended base with the user rather than silently including it.
- Before creating a new feature branch or its worktree, update local `main` with `git pull --ff-only` from its configured upstream in the clean primary `Cicerosstrase` folder. Never pull into another session's feature branch or create a separate integration checkout for `main`.
- Create the feature branch from the updated local `main` only after the pull succeeds. If the pull fails, the upstream is missing, `main` has diverged, or its checkout is dirty, report the blocker and ask before proceeding with a stale base. Never reset local commits, stash another session's changes, or force an update to make the pull succeed.
- Use a sibling directory such as `../Cicerosstrase-worktrees/<session-name>` and a branch such as `feature/<topic>-<unique-suffix>`. Verify the parent directory before creating it, and keep worktrees outside the application directory.
- If the session already has its own isolated worktree and branch, continue there. Do not create another worktree for each follow-up message in the same session.
- Run edits, dependency installation, tests, builds, and development commands from the session worktree. Report its path, branch, and base to the user.
- Documentation-only requests to change this workflow may update `AGENTS.md` in the current checkout without starting a feature worktree or preview server. Pure questions and read-only reviews do not require either.

## Provide an Isolated Preview

- For each explicitly requested worktree implementation session, start an isolated development server so the user can inspect changes while work continues. Ensure it is available before handing the feature back for review, including when the user asks for a preview before finishing. Default main-checkout sessions reuse the user's main server as described above.
- Install dependencies in the worktree when necessary. Check required local configuration; never commit secrets or print their contents. Ask for missing configuration if it prevents the preview from working.
- Choose an unused local port, normally starting at `5174`, rather than assuming the main checkout's default port `5173` is available. Start Vite from the worktree with `npm run dev -- --port <port> --strictPort`.
- If the port is occupied or becomes occupied during startup, choose another port and retry. Never stop an existing process merely to free a port.
- Keep the server running across turns using the environment's supported background-process mechanism. Record the session's server PID, port, and log location so only that server is stopped later.
- Verify that the preview responds and give the user its exact browser URL, for example `http://127.0.0.1:5174`. If startup fails, explain the blocker instead of claiming the preview is running.

## Finish Only on Request

- Completing a requested change is not permission to commit, merge, or push. Wait until the user says "done", "finished", "merge", or explicitly asks to commit and integrate the session. This also applies to documentation-only updates to `AGENTS.md`.
- Leave the session's changes available for review while waiting; for worktree sessions, also keep the feature branch and preview available. When the user says "done", "finished", or "merge", always commit the session's changes and push `main` to its configured GitHub upstream without a separate push confirmation. Default sessions commit directly on `main`; worktree sessions first merge into `main` in the primary folder. This is required, not merely permitted, and includes documentation-only changes to `AGENTS.md`. Do not stop after a local commit or merge. Only an explicit user restriction (for example, "merge locally only") or a reported safety or verification blocker may prevent the push.
- Before committing, inspect `git status`, `git diff`, and `git log --oneline -10`. Stage only intended session files, check for secrets, and use a concise commit message consistent with the repository. Do not amend commits unless explicitly requested.
- Before integrating, review the session's changes, run relevant tests and the build, and report any verification failures. For worktree sessions, also review all session commits and the diff against current `main` before merging. Resolve failures before integrating; ask the user if a blocker requires a decision.
- For documentation-only changes, review the documentation diff and run `git diff --check`; application tests, builds, and preview servers are not required when no application code or configuration changed.
- For worktree sessions, merge into `main` in the clean primary `Cicerosstrase` folder. Check its branch and status immediately before merging. If it has uncommitted changes, stop and ask; never stash or commit unrelated work to make it clean. For default sessions and authorized documentation-only updates already made on `main`, commit only those session changes there without creating an artificial feature merge.
- Never stash, discard, overwrite, or commit another session's changes. Never force-push, reset branches, or bypass Git hooks. If conflicts involve unfamiliar concurrent work, ask the user rather than guessing.
- Verify the committed or merged result with relevant checks, then push `main` to its configured GitHub upstream as authorized above. Review all outgoing commits before pushing, including any already-local commits; ask before publishing unfamiliar work. If the upstream is missing or the push is rejected, report the blocker and ask rather than force-pushing. Verify and report the commit, merge (if applicable), and push outcomes and any remaining issues.
- For worktree sessions, after a successful merge, verification, and authorized push (or an explicitly local-only merge), stop only this session's preview process. Remove its worktree and branch only after confirming the branch is merged and the worktree contains no uncommitted changes or untracked files that need preserving; never force cleanup. Leave all other sessions and servers alone. Default sessions have no worktree cleanup; preserve the primary checkout and its server.

## Discard on Request

- For default main-checkout sessions, follow the discard rule in "Default: Work Directly on Main": undo only this session's uncommitted changes after checking for overlapping edits, and ask before reverting committed or pushed changes.
- For worktree sessions, when the user says "remove" or "delete" to reject the current session's feature, stop its preview server, remove its dedicated worktree, and delete its branch. Do not revert or delete application files individually, commit the rejected work, or merge it.
- Verify the session's process, worktree, and branch before removal. This request authorizes discarding the rejected session's uncommitted changes and unmerged commits, including forced worktree removal or branch deletion when needed. If unfamiliar changes are present, ask before discarding them. Leave the shared checkout, other sessions, and other servers untouched.
- If the feature was already merged, deleting its branch and worktree will not remove it from main; explain this and ask before reverting integrated changes.
