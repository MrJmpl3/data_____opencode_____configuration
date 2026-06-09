import type { DelegationForContext } from './types.ts';

export const DELEGATION_RULES = `<task-notification>
<delegation-system>

## Async Background Delegation

You have tools for parallel background work:
- \`delegate(prompt, agent)\` - Launch background task, returns ID immediately
- \`delegation_read(id)\` - Retrieve completed result
- \`delegation_list()\` - List delegations (use sparingly)

## When to Use delegate vs task

| Tool | Behavior | Use When |
|------|----------|----------|
| \`delegate\` | Async, background, persisted to disk | You want to continue working while it runs |
| \`task\` | Synchronous, blocks until complete | You need the result before continuing |

Any agent can be used with \`delegate\`. Results survive context compaction.

## How It Works

1. Call \`delegate(prompt, agent)\` with a detailed prompt and agent name
2. Continue productive work while it runs in the background
3. Receive a \`<task-notification>\` when complete (compact: ID + status only)
4. Use \`delegation_read(id)\` to retrieve the full result when needed

## Critical Constraints

**NEVER poll \`delegation_list\` to check completion.**
You WILL be notified via \`<task-notification>\`. Polling wastes tokens.

**NEVER wait idle.** Always have productive work while delegations run.

**NOTE:** Background delegations run in isolated sessions. Changes made by write-capable
agents in background sessions are NOT tracked by OpenCode's undo/branching system.

</delegation-system>
</task-notification>`;

// ==========================================
// COMPACTION CONTEXT FORMATTING
// ==========================================

/**
 * Format delegation context for injection during compaction.
 * Includes running delegations with notification reminder (only when running exist),
 * and recent completed delegations with full descriptions.
 */
export function formatDelegationContext(running: DelegationForContext[], completed: DelegationForContext[]): string {
  const sections: string[] = ['<delegation-context>'];

  // Running delegations (if any)
  if (running.length > 0) {
    sections.push('## Running Delegations');
    sections.push('');
    for (const d of running) {
      sections.push(`### \`${d.id}\`${d.agent ? ` (${d.agent})` : ''}`);
      if (d.startedAt) {
        sections.push(`**Started:** ${d.startedAt.toISOString()}`);
      }
      if (d.prompt) {
        const truncatedPrompt = d.prompt.length > 200 ? `${d.prompt.slice(0, 200)}...` : d.prompt;
        sections.push(`**Prompt:** ${truncatedPrompt}`);
      }
      sections.push('');
    }

    // Only include reminder when there ARE running delegations
    sections.push('> **Note:** You WILL be notified via a **Task Notification** blockquote when delegations complete.');
    sections.push('> Do NOT poll `delegation_list` - continue productive work.');
    sections.push('');
  }

  // Completed delegations (recent) — compact: just ID + status, full output is on disk
  if (completed.length > 0) {
    sections.push('## Recent Completed Delegations');
    sections.push('');
    for (const d of completed) {
      sections.push(`- \`${d.id}\` [${d.status}]`);
    }
    sections.push('');
    sections.push('> Use `delegation_read(id)` to get full output for any completed delegation.');
    sections.push('');
  }

  sections.push('## Retrieval');
  sections.push('Use `delegation_read("id")` to access full delegation output.');
  sections.push('</delegation-context>');

  return sections.join('\n');
}
