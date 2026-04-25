## Workspace Local Skills

This workspace uses local skills stored inside `./skills`.

For this workspace, prefer local skills over globally installed skills when both exist.

### Available workspace local skills

- `codex-subagent-orchestrator`: supervise one or more `codex exec` workers for delegated implementation, review, analysis, or generation work. Trigger when the user starts with `/sub`, or asks for subagents, worker teams, delegated execution, parallel Codex runs, supervisory workflows, or multi-agent delivery in this workspace. File: `./skills/codex-subagent-orchestrator/SKILL.md`

### Workspace local skill rules

- If the user starts with `/sub`, you must treat that as a workspace-local subagent orchestration request.
- For `/sub` and other obvious subagent orchestration requests, open and follow `./skills/codex-subagent-orchestrator/SKILL.md`.
- For `/sub`, choose the orchestration shape autonomously from the request context:
  - use the team launcher path for one-off bounded tasks, single tickets, or finite delivery requests
  - use the queue runner path for unattended polling, repeated ticket dispatch, background issue handling, tracker monitoring, or "keep processing work" requests
- Resolve all relative paths from `./skills/codex-subagent-orchestrator/` first.
- Keep the workflow self-contained in this workspace when possible.
- For `/sub` work, the parent should stay in supervisor mode for requested deliverable files.
- For `/sub` work, reviewers and validators should default to `read-only`.
