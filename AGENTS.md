# Session Workflow

## Isolate Each Feature

- At the start of each new implementation session, create a dedicated Git worktree and a uniquely named branch before editing application files. Never develop in the shared checkout or reuse another session's branch.
- Inspect `git status`, `git worktree list`, and existing branches first. Preserve all existing changes, worktrees, and running servers belonging to the user or other sessions.
- Default to branching from local `main`. If the task needs unmerged work from another branch, confirm the intended base with the user rather than silently including it.
- Use a sibling directory such as `../Cicerosstrase-worktrees/<session-name>` and a branch such as `feature/<topic>-<unique-suffix>`. Verify the parent directory before creating it, and keep worktrees outside the application directory.
- If the session already has its own isolated worktree and branch, continue there. Do not create another worktree for each follow-up message in the same session.
- Run edits, dependency installation, tests, builds, and development commands from the session worktree. Report its path, branch, and base to the user.
- Documentation-only requests to change this workflow may update `AGENTS.md` in the current checkout without starting a feature worktree or preview server. Pure questions and read-only reviews do not require either.

## Provide an Isolated Preview

- Start a development server for every implementation session so the user can inspect changes while work continues. Ensure it is available before handing the feature back for review, including when the user asks for a preview before finishing.
- Install dependencies in the worktree when necessary. Check required local configuration; never commit secrets or print their contents. Ask for missing configuration if it prevents the preview from working.
- Choose an unused local port, normally starting at `5174`, rather than assuming the main checkout's default port `5173` is available. Start Vite from the worktree with `npm run dev -- --port <port> --strictPort`.
- If the port is occupied or becomes occupied during startup, choose another port and retry. Never stop an existing process merely to free a port.
- Keep the server running across turns using the environment's supported background-process mechanism. Record the session's server PID, port, and log location so only that server is stopped later.
- Verify that the preview responds and give the user its exact browser URL, for example `http://127.0.0.1:5174`. If startup fails, explain the blocker instead of claiming the preview is running.

## Finish Only on Request

- Completing implementation is not permission to merge. Leave the feature branch and preview available for review until the user says "done", "merge", or explicitly asks to finish and integrate the session. Interpret "done" in this feature-review context as authorization to commit the session's changes and merge its branch into local `main`.
- Before committing, inspect `git status`, `git diff`, and `git log --oneline -10`. Stage only intended session files, check for secrets, and use a concise commit message consistent with the repository. Do not amend commits unless explicitly requested.
- Before merging, review all session commits and the diff against current `main`, run relevant tests and the build, and report any verification failures. Resolve failures before integrating; ask the user if a blocker requires a decision.
- Merge into `main` in a clean integration checkout. If `main` is already checked out in another worktree, inspect that worktree and use it only if clean; otherwise stop and ask. If necessary, create a separate integration worktree for `main`. Do not switch the shared working checkout away from its current branch.
- Never stash, discard, overwrite, or commit another session's changes. Never force-push, reset branches, or bypass Git hooks. If conflicts involve unfamiliar concurrent work, ask the user rather than guessing.
- Verify the merged result with relevant checks. Report the merge outcome and any remaining issues. Do not push unless explicitly requested.
- After a successful merge and verification, stop only this session's preview process. Remove its worktree and branch only after confirming the branch is merged and the worktree contains no uncommitted changes or untracked files that need preserving; never force cleanup. Leave all other sessions and servers alone.
