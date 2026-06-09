import type { AgentModelResolution, OpencodeClient, PermissionEntry } from './types.ts';
import type { Logger } from './logger.ts';

/**
 * Parse agent mode at boundary.
 * Returns trusted type indicating if agent is a sub-agent.
 */
export async function parseAgentMode(
  client: OpencodeClient,
  agentName: string,
  log: Logger,
): Promise<{ isSubAgent: boolean }> {
  try {
    const result = await client.app.agents({});
    const agents = (result.data ?? []) as { name: string; mode?: string }[];
    const agent = agents.find((a) => a.name === agentName);
    return { isSubAgent: agent?.mode === 'subagent' };
  } catch (error) {
    // Fail-safe: Agent list errors shouldn't block task calls
    // Fail-loud: Log for observability
    log.warn(
      `Agent list fetch failed for "${agentName}", assuming non-sub-agent: ${error instanceof Error ? error.message : String(error)}`,
    );
    return { isSubAgent: false };
  }
}

/**
 * Permission entry type: simple value or pattern object.
 * Matches CLI schema: z.union([z.enum(["ask", "allow", "deny"]), z.record(z.enum(...))])
 */

/**
 * Check if a permission entry denies access (Law 4: Fail Fast).
 * Handles both simple values ("deny") and pattern objects ({ "*": "deny" }).
 */
export function isPermissionDenied(entry: PermissionEntry | undefined): boolean {
  if (entry === undefined) return false;
  if (entry === 'deny') return true;
  if (typeof entry === 'object' && entry['*'] === 'deny') return true;
  return false;
}

/**
 * Parse agent write capability at boundary.
 * Returns trusted type indicating if agent is read-only.
 *
 * An agent is read-only when ALL of: edit, write, and bash are denied.
 * Permission schema supports both simple ("deny") and pattern ({ "*": "deny" }) values.
 */
export async function parseAgentWriteCapability(
  client: OpencodeClient,
  agentName: string,
  log: Logger,
): Promise<{ isReadOnly: boolean }> {
  try {
    const config = await client.config.get();
    const configData = config.data as {
      agent?: Record<
        string,
        {
          permission?: Record<string, PermissionEntry>;
        }
      >;
    };
    const permission = configData?.agent?.[agentName]?.permission ?? {};

    const editDenied = isPermissionDenied(permission.edit);
    const writeDenied = isPermissionDenied(permission.write);
    const bashDenied = isPermissionDenied(permission.bash);

    return { isReadOnly: editDenied && writeDenied && bashDenied };
  } catch (error) {
    // Fail-safe: Config errors shouldn't block task calls
    // Fail-loud: Log for observability
    log.warn(
      `Config fetch failed for "${agentName}", assuming write-capable: ${error instanceof Error ? error.message : String(error)}`,
    );
    return { isReadOnly: false };
  }
}

/**
 * Resolve the model and variant configured for a given agent.
 * Parses the "provider/model-id" format into the shape session.prompt() expects.
 * Also reads the optional "variant" (effort level) field from the agent config.
 * Returns undefined when no model is configured (caller falls back to default).
 */
export async function resolveAgentModel(
  client: OpencodeClient,
  agentName: string,
  log: Logger,
): Promise<AgentModelResolution | undefined> {
  try {
    const config = await client.config.get();
    const configData = config.data as
      | {
          agent?: Record<string, { model?: string; variant?: string }>;
        }
      | undefined;

    const modelStr = configData?.agent?.[agentName]?.model;
    if (!modelStr) return undefined;

    const slashIndex = modelStr.indexOf('/');
    if (slashIndex === -1) return undefined;

    const providerID = modelStr.substring(0, slashIndex);
    const modelID = modelStr.substring(slashIndex + 1);

    const variant = configData?.agent?.[agentName]?.variant || undefined;

    await log.info(
      `resolveAgentModel: ${agentName} → ${providerID}/${modelID}${variant ? ` (variant: ${variant})` : ''}`,
    );
    return { providerID, modelID, variant };
  } catch {
    return undefined;
  }
}
