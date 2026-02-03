/**
 * Board Tool
 *
 * Agent tool for interacting with project boards.
 * Enables autonomous project management during heartbeats.
 */

import { Type } from "@sinclair/typebox";
import type { OpenClawConfig } from "../../config/config.js";
import {
  type Ticket,
  type TicketStatus,
  type TicketType,
  type TicketPriority,
  type BoardSummary,
  TICKET_STATUS_ORDER,
  TICKET_PRIORITY_ORDER,
} from "../../board/types.js";
import {
  initBoard,
  loadBoard,
  loadBoardWithTickets,
  createTicket,
  updateTicket,
  moveTicket,
  deleteTicket,
  loadTicket,
  getTicketsByStatus,
  getBoardSummary,
  getNextWorkItem,
  getNextRefinementItem,
  getStaleTickets,
  getBlockedTickets,
  getChildTickets,
  listTickets,
} from "../../board/storage.js";
import { resolveAgentWorkspaceDir, resolveSessionAgentId } from "../agent-scope.js";
import { stringEnum, optionalStringEnum } from "../schema/typebox.js";
import { type AnyAgentTool, jsonResult, readStringParam } from "./common.js";

const BOARD_ACTIONS = [
  "init",
  "status",
  "list",
  "view",
  "create",
  "update",
  "move",
  "delete",
  "next-work",
  "next-refine",
  "stale",
  "blocked",
  "children",
] as const;

const BoardToolSchema = Type.Object({
  action: stringEnum(BOARD_ACTIONS),

  // For init
  projectId: Type.Optional(Type.String()),
  projectName: Type.Optional(Type.String()),

  // For list
  column: optionalStringEnum(TICKET_STATUS_ORDER),
  type: optionalStringEnum(["epic", "story", "task", "bug", "research"]),

  // For view, update, move, delete, children
  ticketId: Type.Optional(Type.String()),
  id: Type.Optional(Type.String()), // Alias for ticketId

  // For create
  title: Type.Optional(Type.String()),
  ticketType: optionalStringEnum(["epic", "story", "task", "bug", "research"]),
  priority: optionalStringEnum(TICKET_PRIORITY_ORDER),
  description: Type.Optional(Type.String()),
  acceptanceCriteria: Type.Optional(Type.Array(Type.String())),
  parentId: Type.Optional(Type.String()),
  tags: Type.Optional(Type.Array(Type.String())),
  estimate: Type.Optional(Type.String()),

  // For update
  researchNotes: Type.Optional(Type.String()),
  progressNotes: Type.Optional(Type.String()),
  blocks: Type.Optional(Type.Array(Type.String())),
  blockedBy: Type.Optional(Type.Array(Type.String())),

  // For move
  toStatus: optionalStringEnum(TICKET_STATUS_ORDER),
  note: Type.Optional(Type.String()),
});

type BoardToolOptions = {
  config?: OpenClawConfig;
  agentSessionKey?: string;
};

function formatTicketSummary(ticket: Ticket): string {
  const priority = ticket.priority.toUpperCase().slice(0, 1);
  const type = ticket.type.slice(0, 1).toUpperCase();
  return `[${ticket.id}] ${priority}${type} ${ticket.title} (${ticket.status})`;
}

function formatBoardStatus(summary: BoardSummary): string {
  const lines: string[] = [
    `# ${summary.projectName} Board`,
    "",
    "## Columns",
  ];

  for (const status of TICKET_STATUS_ORDER) {
    const count = summary.columnCounts[status] ?? 0;
    if (count > 0 || status !== "blocked") {
      lines.push(`- ${status}: ${count}`);
    }
  }

  lines.push("");
  lines.push("## Health");
  lines.push(`- Total tickets: ${summary.totalTickets}`);

  if (summary.blockedCount > 0) {
    lines.push(`- ⚠️ Blocked: ${summary.blockedCount}`);
  }
  if (summary.staleCount > 0) {
    lines.push(`- ⚠️ Stale (in-progress): ${summary.staleCount}`);
  }
  if (summary.oldestBacklogAge) {
    lines.push(`- Oldest backlog: ${summary.oldestBacklogAge}`);
  }
  if (summary.oldestInProgressAge) {
    lines.push(`- Oldest in-progress: ${summary.oldestInProgressAge}`);
  }

  return lines.join("\n");
}

export function createBoardTool(opts?: BoardToolOptions): AnyAgentTool | null {
  const cfg = opts?.config;
  if (!cfg) {
    return null;
  }

  const agentId = resolveSessionAgentId({
    sessionKey: opts?.agentSessionKey,
    config: cfg,
  });

  const workspaceDir = resolveAgentWorkspaceDir(cfg, agentId);

  return {
    label: "Board",
    name: "board",
    description: `Project board management for autonomous work.

ACTIONS:
- init: Initialize board (requires projectId, projectName)
- status: Get board overview (columns, health, blocked/stale counts)
- list: List tickets (optional column/type filter)
- view: View ticket details (requires ticketId)
- create: Create ticket (requires title, optional type/priority/description/acceptanceCriteria)
- update: Update ticket (requires ticketId, any updatable fields)
- move: Move ticket to column (requires ticketId, toStatus, optional note)
- delete: Delete ticket (requires ticketId)
- next-work: Get next ticket ready to work (respects WIP limits)
- next-refine: Get next backlog item to refine (epics/stories first)
- stale: List stale in-progress tickets (>24h)
- blocked: List blocked tickets
- children: List child tickets of a parent (requires ticketId)

TICKET TYPES: epic, story, task, bug, research
PRIORITIES: critical, high, medium, low
COLUMNS: backlog → refinement → ready → in-progress → review → done

WORKFLOW:
1. Vague ideas go to backlog as epics/stories
2. Refinement breaks them into concrete tasks with acceptance criteria
3. Ready items are prioritized for work
4. In-progress respects WIP limits (default: 2)
5. Review verifies acceptance criteria
6. Done marks completion

Use during heartbeat to autonomously manage project work.`,
    parameters: BoardToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });
      const ticketId =
        readStringParam(params, "ticketId") ?? readStringParam(params, "id");

      switch (action) {
        case "init": {
          const projectId = readStringParam(params, "projectId", { required: true });
          const projectName = readStringParam(params, "projectName", { required: true });
          const board = await initBoard(workspaceDir, projectId, projectName);
          return jsonResult({
            status: "ok",
            message: `Board initialized: ${board.projectName}`,
            projectId: board.projectId,
            ticketPrefix: board.settings.ticketPrefix,
          });
        }

        case "status": {
          const summary = await getBoardSummary(workspaceDir);
          if (!summary) {
            return jsonResult({
              status: "error",
              message: "Board not initialized. Use action=init first.",
            });
          }
          return jsonResult({
            status: "ok",
            summary,
            formatted: formatBoardStatus(summary),
          });
        }

        case "list": {
          const board = await loadBoard(workspaceDir);
          if (!board) {
            return jsonResult({
              status: "error",
              message: "Board not initialized",
            });
          }

          let tickets: Ticket[];
          const column = params.column as TicketStatus | undefined;
          if (column) {
            tickets = await getTicketsByStatus(workspaceDir, column);
          } else {
            tickets = await listTickets(workspaceDir);
          }

          const filterType = params.type as TicketType | undefined;
          if (filterType) {
            tickets = tickets.filter((t) => t.type === filterType);
          }

          const summaries = tickets.map(formatTicketSummary);
          return jsonResult({
            status: "ok",
            count: tickets.length,
            tickets: tickets.map((t) => ({
              id: t.id,
              title: t.title,
              type: t.type,
              status: t.status,
              priority: t.priority,
            })),
            formatted: summaries.join("\n") || "(no tickets)",
          });
        }

        case "view": {
          if (!ticketId) {
            throw new Error("ticketId required");
          }
          const ticket = await loadTicket(workspaceDir, ticketId);
          if (!ticket) {
            return jsonResult({
              status: "error",
              message: `Ticket not found: ${ticketId}`,
            });
          }
          return jsonResult({ status: "ok", ticket });
        }

        case "create": {
          const title = readStringParam(params, "title", { required: true });
          const ticket = await createTicket(workspaceDir, {
            title,
            type: params.ticketType as TicketType | undefined,
            priority: params.priority as TicketPriority | undefined,
            description: readStringParam(params, "description"),
            acceptanceCriteria: params.acceptanceCriteria as string[] | undefined,
            parentId: readStringParam(params, "parentId"),
            tags: params.tags as string[] | undefined,
            estimate: readStringParam(params, "estimate"),
          });
          return jsonResult({
            status: "ok",
            message: `Created ticket: ${ticket.id}`,
            ticket: {
              id: ticket.id,
              title: ticket.title,
              type: ticket.type,
              status: ticket.status,
              priority: ticket.priority,
            },
          });
        }

        case "update": {
          if (!ticketId) {
            throw new Error("ticketId required");
          }
          const ticket = await updateTicket(workspaceDir, ticketId, {
            title: readStringParam(params, "title"),
            type: params.ticketType as TicketType | undefined,
            priority: params.priority as TicketPriority | undefined,
            description: readStringParam(params, "description"),
            acceptanceCriteria: params.acceptanceCriteria as string[] | undefined,
            researchNotes: readStringParam(params, "researchNotes"),
            progressNotes: readStringParam(params, "progressNotes"),
            estimate: readStringParam(params, "estimate"),
            tags: params.tags as string[] | undefined,
            blocks: params.blocks as string[] | undefined,
            blockedBy: params.blockedBy as string[] | undefined,
          });
          return jsonResult({
            status: "ok",
            message: `Updated ticket: ${ticket.id}`,
            ticket: {
              id: ticket.id,
              title: ticket.title,
              status: ticket.status,
            },
          });
        }

        case "move": {
          if (!ticketId) {
            throw new Error("ticketId required");
          }
          const toStatus = params.toStatus as TicketStatus;
          if (!toStatus) {
            throw new Error("toStatus required");
          }
          const note = readStringParam(params, "note");
          const ticket = await moveTicket(workspaceDir, ticketId, toStatus, note);
          return jsonResult({
            status: "ok",
            message: `Moved ${ticket.id} to ${toStatus}`,
            ticket: {
              id: ticket.id,
              title: ticket.title,
              status: ticket.status,
            },
          });
        }

        case "delete": {
          if (!ticketId) {
            throw new Error("ticketId required");
          }
          const deleted = await deleteTicket(workspaceDir, ticketId);
          return jsonResult({
            status: deleted ? "ok" : "error",
            message: deleted ? `Deleted ticket: ${ticketId}` : `Ticket not found: ${ticketId}`,
          });
        }

        case "next-work": {
          const ticket = await getNextWorkItem(workspaceDir);
          if (!ticket) {
            return jsonResult({
              status: "ok",
              message: "No work available (WIP limit reached or no ready items)",
              ticket: null,
            });
          }
          return jsonResult({
            status: "ok",
            message: `Next work item: ${formatTicketSummary(ticket)}`,
            ticket,
          });
        }

        case "next-refine": {
          const ticket = await getNextRefinementItem(workspaceDir);
          if (!ticket) {
            return jsonResult({
              status: "ok",
              message: "No items to refine (WIP limit reached or backlog empty)",
              ticket: null,
            });
          }
          return jsonResult({
            status: "ok",
            message: `Next refinement item: ${formatTicketSummary(ticket)}`,
            ticket,
          });
        }

        case "stale": {
          const board = await loadBoard(workspaceDir);
          const staleHours = board?.settings.staleInProgressHours ?? 24;
          const tickets = await getStaleTickets(workspaceDir, staleHours);
          return jsonResult({
            status: "ok",
            count: tickets.length,
            tickets: tickets.map((t) => ({
              id: t.id,
              title: t.title,
              statusChangedAt: t.statusChangedAt,
            })),
            formatted:
              tickets.map(formatTicketSummary).join("\n") ||
              "(no stale tickets)",
          });
        }

        case "blocked": {
          const tickets = await getBlockedTickets(workspaceDir);
          return jsonResult({
            status: "ok",
            count: tickets.length,
            tickets: tickets.map((t) => ({
              id: t.id,
              title: t.title,
              blockedBy: t.blockedBy,
            })),
            formatted:
              tickets.map(formatTicketSummary).join("\n") ||
              "(no blocked tickets)",
          });
        }

        case "children": {
          if (!ticketId) {
            throw new Error("ticketId required");
          }
          const tickets = await getChildTickets(workspaceDir, ticketId);
          return jsonResult({
            status: "ok",
            parentId: ticketId,
            count: tickets.length,
            tickets: tickets.map((t) => ({
              id: t.id,
              title: t.title,
              type: t.type,
              status: t.status,
            })),
            formatted:
              tickets.map(formatTicketSummary).join("\n") ||
              "(no child tickets)",
          });
        }

        default:
          throw new Error(`Unknown action: ${action}`);
      }
    },
  };
}
