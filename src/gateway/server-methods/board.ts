/**
 * Board Gateway Methods
 *
 * RPC methods for interacting with project boards from the Control UI.
 */

import type { TicketType, TicketStatus } from "../../board/types.js";
import type { GatewayRequestHandlers } from "./types.js";
import { resolveAgentWorkspaceDir, resolveSessionAgentId } from "../../agents/agent-scope.js";
import {
  initBoard,
  listTickets,
  createTicket,
  moveTicket,
  loadTicket,
  updateTicket,
  addComment,
  getBoardSummary,
} from "../../board/storage.js";
import { loadConfig, type OpenClawConfig } from "../../config/config.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";

type BoardMethodParams = {
  sessionKey?: string;
};

type BoardInitParams = BoardMethodParams & {
  projectName?: string;
};

type BoardCreateParams = BoardMethodParams & {
  title: string;
  ticketType?: string;
  intent?: string;
  acceptanceSignal?: string;
};

type BoardMoveParams = BoardMethodParams & {
  ticketId: string;
  toStatus: string;
  note?: string;
};

type BoardViewParams = BoardMethodParams & {
  ticketId: string;
};

type BoardUpdateParams = BoardMethodParams & {
  ticketId: string;
  title?: string;
  ticketType?: string;
  intent?: string;
  acceptanceSignal?: string;
  comment?: string;
};

function resolveWorkspace(cfg: OpenClawConfig, sessionKey?: string): string {
  const agentId = resolveSessionAgentId({
    sessionKey,
    config: cfg,
  });
  return resolveAgentWorkspaceDir(cfg, agentId);
}

function resolveAgentInfo(cfg: OpenClawConfig, sessionKey?: string) {
  const agentId = resolveSessionAgentId({
    sessionKey,
    config: cfg,
  });
  const agentConfig = cfg.agents?.list?.find((a) => a.id === agentId);
  return {
    agentId,
    agentName: agentConfig?.name ?? agentId,
  };
}

export const boardMethods: GatewayRequestHandlers = {
  "board.init": async ({ params, respond }) => {
    const p = params as BoardInitParams;
    const cfg = loadConfig();
    const workspaceDir = resolveWorkspace(cfg, p.sessionKey);
    const { agentId, agentName } = resolveAgentInfo(cfg, p.sessionKey);
    const projectName = p.projectName ?? agentName;

    try {
      const board = await initBoard(workspaceDir, agentId, projectName);
      respond(true, {
        ok: true,
        projectId: board.projectId,
        projectName: board.projectName,
      });
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          err instanceof Error ? err.message : "Failed to init board",
        ),
      );
    }
  },

  "board.status": async ({ params, respond }) => {
    const p = params as BoardMethodParams;
    const cfg = loadConfig();
    const workspaceDir = resolveWorkspace(cfg, p.sessionKey);

    try {
      const summary = await getBoardSummary(workspaceDir);

      if (!summary) {
        respond(true, { ok: false, error: "Board not initialized" });
        return;
      }

      respond(true, {
        ok: true,
        projectId: summary.id,
        projectName: summary.projectName,
        columnCounts: summary.columnCounts,
        totalTickets: summary.totalTickets,
        staleCount: summary.staleCount,
      });
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          err instanceof Error ? err.message : "Failed to get board status",
        ),
      );
    }
  },

  "board.list": async ({ params, respond }) => {
    const p = params as BoardMethodParams;
    const cfg = loadConfig();
    const workspaceDir = resolveWorkspace(cfg, p.sessionKey);

    try {
      const tickets = await listTickets(workspaceDir);

      respond(true, {
        ok: true,
        tickets: tickets.map((t) => ({
          id: t.id,
          title: t.title,
          type: t.type,
          status: t.status,
          intent: t.intent,
          commentCount: t.comments?.length ?? 0,
          codeLocation: t.codeLocation,
          createdAt: t.createdAt,
          updatedAt: t.updatedAt,
        })),
      });
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          err instanceof Error ? err.message : "Failed to list tickets",
        ),
      );
    }
  },

  "board.view": async ({ params, respond }) => {
    const p = params as BoardViewParams;
    const cfg = loadConfig();
    const workspaceDir = resolveWorkspace(cfg, p.sessionKey);

    if (!p.ticketId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "ticketId is required"));
      return;
    }

    try {
      const ticket = await loadTicket(workspaceDir, p.ticketId);
      if (!ticket) {
        respond(true, { ok: false, error: `Ticket not found: ${p.ticketId}` });
        return;
      }

      respond(true, { ok: true, ticket });
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          err instanceof Error ? err.message : "Failed to view ticket",
        ),
      );
    }
  },

  "board.update": async ({ params, respond }) => {
    const p = params as BoardUpdateParams;
    const cfg = loadConfig();
    const workspaceDir = resolveWorkspace(cfg, p.sessionKey);

    if (!p.ticketId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "ticketId is required"));
      return;
    }

    try {
      // If there's a comment, add it
      if (p.comment?.trim()) {
        const { agentName } = resolveAgentInfo(cfg, p.sessionKey);
        await addComment(workspaceDir, p.ticketId, agentName, p.comment.trim());
      }

      // If there are field updates, apply them
      const hasFieldUpdates = p.title || p.ticketType || p.intent || p.acceptanceSignal;
      if (hasFieldUpdates) {
        const ticket = await updateTicket(workspaceDir, p.ticketId, {
          title: p.title,
          type: p.ticketType as TicketType | undefined,
          intent: p.intent,
          acceptanceSignal: p.acceptanceSignal,
        });

        respond(true, {
          ok: true,
          ticket: {
            id: ticket.id,
            title: ticket.title,
            status: ticket.status,
          },
        });
      } else {
        // Just added a comment, return current ticket
        const ticket = await loadTicket(workspaceDir, p.ticketId);
        respond(true, {
          ok: true,
          ticket: ticket
            ? {
                id: ticket.id,
                title: ticket.title,
                status: ticket.status,
              }
            : null,
        });
      }
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          err instanceof Error ? err.message : "Failed to update ticket",
        ),
      );
    }
  },

  "board.create": async ({ params, respond }) => {
    const p = params as BoardCreateParams;
    const cfg = loadConfig();
    const workspaceDir = resolveWorkspace(cfg, p.sessionKey);

    if (!p.title) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "title is required"));
      return;
    }

    try {
      const ticket = await createTicket(workspaceDir, {
        title: p.title,
        type: (p.ticketType as TicketType) ?? undefined,
        intent: p.intent,
        acceptanceSignal: p.acceptanceSignal,
      });

      respond(true, {
        ok: true,
        ticket: {
          id: ticket.id,
          title: ticket.title,
          type: ticket.type,
          status: ticket.status,
        },
      });
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          err instanceof Error ? err.message : "Failed to create ticket",
        ),
      );
    }
  },

  "board.move": async ({ params, respond }) => {
    const p = params as BoardMoveParams;
    const cfg = loadConfig();
    const workspaceDir = resolveWorkspace(cfg, p.sessionKey);

    if (!p.ticketId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "ticketId is required"));
      return;
    }
    if (!p.toStatus) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "toStatus is required"));
      return;
    }

    try {
      const ticket = await moveTicket(workspaceDir, p.ticketId, p.toStatus as TicketStatus, p.note);

      respond(true, {
        ok: true,
        ticket: {
          id: ticket.id,
          title: ticket.title,
          status: ticket.status,
          codeLocation: ticket.codeLocation,
        },
      });
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          err instanceof Error ? err.message : "Failed to move ticket",
        ),
      );
    }
  },
};
