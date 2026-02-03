/**
 * Board Tool
 *
 * Agent tool for interacting with project boards.
 * Enables autonomous project management during heartbeats.
 */

import { Type } from "@sinclair/typebox";
import type { OpenClawConfig } from "../../config/config.js";
import {
  initBoard,
  loadBoard,
  createTicket,
  updateTicket,
  moveTicket,
  deleteTicket,
  loadTicket,
  getTicketsByStatus,
  getBoardSummary,
  getNextWorkItem,
  getStaleTickets,
  addComment,
  listTickets,
} from "../../board/storage.js";
import {
  type Ticket,
  type TicketStatus,
  type TicketType,
  type BoardSummary,
  VALID_STATUSES,
  VALID_TYPES,
} from "../../board/types.js";
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
  "stale",
  "comment",
] as const;

const BoardToolSchema = Type.Object({
  action: stringEnum(BOARD_ACTIONS),

  // For init
  projectId: Type.Optional(Type.String()),
  projectName: Type.Optional(Type.String()),

  // For list
  column: optionalStringEnum(VALID_STATUSES),
  type: optionalStringEnum(VALID_TYPES),

  // For view, update, move, delete, comment
  ticketId: Type.Optional(Type.String()),
  id: Type.Optional(Type.String()), // Alias for ticketId

  // For create / update
  title: Type.Optional(Type.String()),
  ticketType: optionalStringEnum(VALID_TYPES),
  intent: Type.Optional(Type.String()),
  acceptanceSignal: Type.Optional(Type.String()),

  // For move
  toStatus: optionalStringEnum(VALID_STATUSES),
  note: Type.Optional(Type.String()),

  // For comment
  comment: Type.Optional(Type.String()),
});

type BoardToolOptions = {
  config?: OpenClawConfig;
  agentSessionKey?: string;
};

function formatAge(ms: number): string {
  const hours = Math.floor(ms / (1000 * 60 * 60));
  if (hours < 24) {
    return `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function formatTicketSummary(ticket: Ticket): string {
  const type = ticket.type.slice(0, 1).toUpperCase();
  return `[${ticket.id}] ${type} ${ticket.title} (${ticket.status})`;
}

function formatBoardStatus(summary: BoardSummary): string {
  const lines: string[] = [`# ${summary.projectName} Board`, "", "## Columns"];

  for (const status of VALID_STATUSES) {
    const count = summary.columnCounts[status] ?? 0;
    lines.push(`- ${status}: ${count}`);
  }

  lines.push("");
  lines.push("## Health");
  lines.push(`- Total tickets: ${summary.totalTickets}`);

  if (summary.staleCount > 0) {
    lines.push(`- Stale (in-progress): ${summary.staleCount}`);
  }
  if (summary.oldestBacklogAge != null) {
    lines.push(`- Oldest backlog: ${formatAge(summary.oldestBacklogAge)}`);
  }
  if (summary.oldestInProgressAge != null) {
    lines.push(`- Oldest in-progress: ${formatAge(summary.oldestInProgressAge)}`);
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
- status: Get board overview (columns, health, stale counts)
- list: List tickets (optional column/type filter)
- view: View ticket details (requires ticketId)
- create: Create ticket (requires title, optional type/intent/acceptanceSignal)
- update: Update ticket (requires ticketId, any updatable fields)
- move: Move ticket to column (requires ticketId, toStatus, optional note)
- delete: Delete ticket (requires ticketId)
- next-work: Get next ticket ready to work (respects WIP limits)
- stale: List stale in-progress tickets (>24h)
- comment: Add a comment to a ticket (requires ticketId, comment)

TICKET TYPES: feature, bugfix, chore, experiment
COLUMNS: backlog -> ready -> in-progress -> review -> done

MOVEMENT RULES:
- Human moves: backlog->ready (refine) and review->done (accept)
- Agent moves: ready->in-progress (pick up) and in-progress->review (submit)
- codeLocation is auto-derived when moving to in-progress

WORKFLOW:
1. Human creates stories in backlog with intent + acceptanceSignal
2. Human moves refined stories to ready
3. Agent picks up ready items (respects WIP limits), auto-creates branch/worktree
4. Agent moves to review when done
5. Human reviews and moves to done

Use during heartbeat to autonomously manage project work.`,
    parameters: BoardToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });
      const ticketId = readStringParam(params, "ticketId") ?? readStringParam(params, "id");

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
              intent: t.intent,
              commentCount: t.comments?.length ?? 0,
              codeLocation: t.codeLocation,
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
            intent: readStringParam(params, "intent"),
            acceptanceSignal: readStringParam(params, "acceptanceSignal"),
          });
          return jsonResult({
            status: "ok",
            message: `Created ticket: ${ticket.id}`,
            ticket: {
              id: ticket.id,
              title: ticket.title,
              type: ticket.type,
              status: ticket.status,
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
            intent: readStringParam(params, "intent"),
            acceptanceSignal: readStringParam(params, "acceptanceSignal"),
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
              codeLocation: ticket.codeLocation,
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
            formatted: tickets.map(formatTicketSummary).join("\n") || "(no stale tickets)",
          });
        }

        case "comment": {
          if (!ticketId) {
            throw new Error("ticketId required");
          }
          const commentText = readStringParam(params, "comment", { required: true });
          const ticket = await addComment(workspaceDir, ticketId, agentId, commentText);
          return jsonResult({
            status: "ok",
            message: `Comment added to ${ticket.id}`,
            commentCount: ticket.comments?.length ?? 0,
          });
        }

        default:
          throw new Error(`Unknown action: ${action}`);
      }
    },
  };
}
