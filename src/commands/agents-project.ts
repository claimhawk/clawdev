/**
 * Project Agent Command
 *
 * Creates a fully configured project agent with:
 * - Dedicated workspace
 * - Project board for autonomous work
 * - Heartbeat configuration for autonomous operation
 * - Channel binding for communication
 */

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { loadConfig, writeConfigFile } from "../config/config.js";
import type { AgentConfig } from "../config/types.agents.js";
import type { AgentBinding } from "../config/types.agents.js";
import { initBoard } from "../board/storage.js";
import { resolveUserPath } from "../utils.js";
import type { RuntimeEnv } from "../runtime.js";

export type AgentsProjectOptions = {
  /** Project name (also used as agent ID) */
  name?: string;
  /** Workspace directory */
  workspace?: string;
  /** Channel to bind (e.g., "telegram", "discord") */
  channel?: string;
  /** Account ID on the channel */
  accountId?: string;
  /** Heartbeat interval (e.g., "30m", "1h") */
  heartbeat?: string;
  /** Active hours start (e.g., "22:00" for overnight) */
  activeStart?: string;
  /** Active hours end (e.g., "08:00") */
  activeEnd?: string;
  /** Timezone for active hours */
  timezone?: string;
  /** Model to use */
  model?: string;
  /** Skip prompts */
  nonInteractive?: boolean;
  /** JSON output */
  json?: boolean;
};

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32);
}

async function ensureFile(filePath: string, content: string): Promise<void> {
  try {
    await fs.writeFile(filePath, content, { flag: "wx" });
  } catch (err) {
    const anyErr = err as { code?: string };
    if (anyErr.code !== "EEXIST") {
      throw err;
    }
  }
}

function generateSoulMd(projectName: string): string {
  return `# ${projectName}

You are the embodiment of this project. Your purpose is to advance this project autonomously.

## Core Responsibilities

1. **Manage the board**: Keep tickets moving from backlog → done
2. **Refine vague ideas**: Break epics into concrete, actionable tasks
3. **Research proactively**: Gather information to inform decisions
4. **Work autonomously**: During heartbeat, pick up and complete tasks
5. **Document progress**: Update MEMORY.md with findings and decisions

## Work Style

- Focus on one thing at a time (respect WIP limits)
- Quality over speed
- Document your reasoning in progress notes
- When blocked, note it and move on
- Always update acceptance criteria with learnings

## Communication

When the user messages you:
- Treat their input as high-priority backlog items
- Create tickets for any requests
- Provide status updates on board state
- Ask clarifying questions for vague requests
`;
}

function generateHeartbeatMd(): string {
  return `# Autonomous Work Protocol

Execute this protocol during each heartbeat to advance the project.

## Phase 1: Board Assessment

1. Check board status: \`board action=status\`
2. Review blocked tickets: \`board action=blocked\`
3. Check stale in-progress items: \`board action=stale\`
4. If stale items exist, evaluate and either complete or move back to ready

## Phase 2: Work Completion

If you have in-progress work:
1. View the ticket and continue working on acceptance criteria
2. Update progress notes as you go
3. When complete, move to review

## Phase 3: Review Phase

If review items exist:
1. Self-review against acceptance criteria
2. If criteria met, move to done
3. If not met, move back to in-progress with notes

## Phase 4: Refinement Phase

If backlog has epics/stories and refinement is below WIP limit:
1. Get next item: \`board action=next-refine\`
2. Research using \`web_search\`
3. Break into concrete tasks with acceptance criteria
4. Move tasks to ready

## Phase 5: Work Phase

If ready items exist and in-progress below WIP limit:
1. Get next work item: \`board action=next-work\`
2. Move to in-progress and begin working

## Completion

If no actionable work remains, respond:
\`\`\`
HEARTBEAT_OK
\`\`\`
`;
}

function generateMemoryMd(projectName: string): string {
  return `# ${projectName} - Project Memory

This file accumulates knowledge, decisions, and learnings across sessions.

## Key Decisions

<!-- Record important decisions and their rationale here -->

## Research Findings

<!-- Summarize research findings from ticket refinement -->

## Lessons Learned

<!-- Document what worked, what didn't, and why -->
`;
}

export async function agentsProjectCommand(
  opts: AgentsProjectOptions,
  runtime: RuntimeEnv,
): Promise<void> {
  const cfg = loadConfig();

  // Get project name
  let projectName = opts.name?.trim();
  if (!projectName) {
    if (opts.nonInteractive) {
      throw new Error("--name required in non-interactive mode");
    }
    // Would prompt here, but for now require it
    throw new Error("Project name required. Use: openclaw agents project <name>");
  }

  const agentId = slugify(projectName);

  // Check if agent already exists
  const existingAgents = cfg.agents?.list ?? [];
  if (existingAgents.some((a) => a.id === agentId)) {
    throw new Error(`Agent already exists: ${agentId}`);
  }

  // Resolve workspace
  let workspaceDir = opts.workspace?.trim();
  if (!workspaceDir) {
    workspaceDir = path.join(os.homedir(), ".openclaw", `workspace-${agentId}`);
  }
  workspaceDir = resolveUserPath(workspaceDir);

  // Create workspace directory structure
  await fs.mkdir(workspaceDir, { recursive: true });

  // Generate workspace files
  await ensureFile(path.join(workspaceDir, "SOUL.md"), generateSoulMd(projectName));
  await ensureFile(path.join(workspaceDir, "HEARTBEAT.md"), generateHeartbeatMd());
  await ensureFile(path.join(workspaceDir, "MEMORY.md"), generateMemoryMd(projectName));
  await ensureFile(path.join(workspaceDir, "AGENTS.md"), `# Sub-agents\n\nNo sub-agents configured yet.\n`);
  await ensureFile(path.join(workspaceDir, "TOOLS.md"), `# Tools\n\nThis project uses the default tool configuration.\n`);

  // Initialize the project board
  await initBoard(workspaceDir, agentId, projectName);

  // Build agent config
  const heartbeatInterval = opts.heartbeat ?? "30m";
  const agentConfig: AgentConfig = {
    id: agentId,
    workspace: workspaceDir,
  };

  // Add model if specified
  if (opts.model) {
    agentConfig.model = opts.model;
  }

  // Add heartbeat configuration
  agentConfig.heartbeat = {
    every: heartbeatInterval,
    ...(opts.activeStart && opts.activeEnd
      ? {
          activeHours: {
            start: opts.activeStart,
            end: opts.activeEnd,
            ...(opts.timezone ? { timezone: opts.timezone } : {}),
          },
        }
      : {}),
  };

  // Build new bindings array if channel specified
  let newBindings: AgentBinding[] | undefined;
  if (opts.channel) {
    const binding: AgentBinding = {
      agentId,
      match: {
        channel: opts.channel,
        ...(opts.accountId ? { accountId: opts.accountId } : {}),
      },
    };
    newBindings = [...(cfg.bindings ?? []), binding];
  }

  // Update config
  const updatedConfig = {
    ...cfg,
    agents: {
      ...cfg.agents,
      list: [...existingAgents, agentConfig],
    },
    ...(newBindings ? { bindings: newBindings } : {}),
  };

  await writeConfigFile(updatedConfig);

  // Output result
  if (opts.json) {
    console.log(JSON.stringify({
      status: "ok",
      agentId,
      projectName,
      workspace: workspaceDir,
      boardInitialized: true,
      heartbeat: heartbeatInterval,
      channel: opts.channel ?? null,
    }, null, 2));
  } else {
    console.log(`\n✓ Created project agent: ${agentId}`);
    console.log(`  Workspace: ${workspaceDir}`);
    console.log(`  Heartbeat: ${heartbeatInterval}`);
    if (opts.channel) {
      console.log(`  Channel: ${opts.channel}${opts.accountId ? `:${opts.accountId}` : ""}`);
    }
    console.log(`\n  Board initialized with prefix: ${agentId.toUpperCase().slice(0, 4)}`);
    console.log(`\n  Next steps:`);
    console.log(`  1. Add vague goals to backlog: openclaw agent --agent ${agentId} -m "Add to backlog: <your idea>"`);
    console.log(`  2. The agent will refine and work on tasks during heartbeat`);
    console.log(`  3. View progress: openclaw agent --agent ${agentId} -m "Show board status"`);
  }
}
