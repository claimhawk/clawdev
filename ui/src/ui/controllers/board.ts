import type { AppViewState } from "../app-view-state";
import type { BoardColumn } from "../views/board";

type BoardStatusResponse = {
  projectId: string;
  projectName: string;
  columnCounts: Record<string, number>;
  totalTickets: number;
  staleCount: number;
};

type TicketResponse = {
  id: string;
  title: string;
  type: string;
  status: string;
  intent?: string;
  commentCount?: number;
  codeLocation?: { branch: string; worktree: string };
};

type BoardListResponse = {
  tickets: TicketResponse[];
};

const COLUMN_ORDER = ["backlog", "ready", "in-progress", "review", "done"];
const COLUMN_NAMES: Record<string, string> = {
  backlog: "Backlog",
  ready: "Ready",
  "in-progress": "In Progress",
  review: "Review",
  done: "Done",
};
const COLUMN_WIP_LIMITS: Record<string, number | null> = {
  backlog: null,
  ready: 10,
  "in-progress": 2,
  review: 5,
  done: null,
};

export async function loadBoard(state: AppViewState): Promise<void> {
  if (!state.connected || !state.client) {
    state.boardError = "Not connected to gateway";
    return;
  }

  state.boardLoading = true;
  state.boardError = null;

  try {
    // Get board status for the current session's agent
    let statusResult = await state.client.request<BoardStatusResponse>("board.status", {
      sessionKey: state.sessionKey,
    });

    // Auto-initialize board if it doesn't exist
    if (!statusResult || !statusResult.projectId) {
      await state.client.request("board.init", {
        sessionKey: state.sessionKey,
      });
      // Retry getting status after init
      statusResult = await state.client.request<BoardStatusResponse>("board.status", {
        sessionKey: state.sessionKey,
      });
    }

    if (!statusResult || !statusResult.projectId) {
      state.board = null;
      state.boardLoading = false;
      return;
    }

    // Get all tickets
    const listResult = await state.client.request<BoardListResponse>("board.list", {
      sessionKey: state.sessionKey,
    });

    const ticketsData: TicketResponse[] = listResult?.tickets || [];

    // Group tickets by status
    const ticketsByStatus = new Map<string, TicketResponse[]>();
    for (const ticket of ticketsData) {
      const status = ticket.status || "backlog";
      if (!ticketsByStatus.has(status)) {
        ticketsByStatus.set(status, []);
      }
      ticketsByStatus.get(status)!.push(ticket);
    }

    // Build columns
    const columns: BoardColumn[] = COLUMN_ORDER.map((columnId) => ({
      id: columnId,
      name: COLUMN_NAMES[columnId] || columnId,
      wipLimit: COLUMN_WIP_LIMITS[columnId] ?? null,
      tickets: (ticketsByStatus.get(columnId) || []).map((t) => ({
        id: t.id,
        title: t.title,
        type: t.type as "feature" | "bugfix" | "chore" | "experiment",
        status: t.status,
        intent: t.intent,
        commentCount: t.commentCount ?? 0,
        codeLocation: t.codeLocation,
      })),
    }));

    state.board = {
      projectId: statusResult.projectId,
      projectName: statusResult.projectName,
      columns,
      totalTickets: statusResult.totalTickets || ticketsData.length,
      staleCount: statusResult.staleCount || 0,
    };
  } catch (err) {
    console.error("[board] Failed to load board:", err);
    state.boardError = err instanceof Error ? err.message : "Failed to load board";
    state.board = null;
  } finally {
    state.boardLoading = false;
  }
}

export async function moveTicket(
  state: AppViewState,
  ticketId: string,
  toStatus: string,
): Promise<void> {
  if (!state.connected || !state.client) {
    return;
  }

  try {
    await state.client.request("board.move", {
      sessionKey: state.sessionKey,
      ticketId,
      toStatus,
    });

    // Refresh board after move
    await loadBoard(state);
  } catch (err) {
    console.error("[board] Failed to move ticket:", err);
    state.boardError = err instanceof Error ? err.message : "Failed to move ticket";
  }
}

export async function createTicket(
  state: AppViewState,
  title: string,
  type: string,
  intent?: string,
): Promise<void> {
  if (!state.connected || !state.client) {
    return;
  }

  try {
    await state.client.request("board.create", {
      sessionKey: state.sessionKey,
      title,
      ticketType: type,
      intent,
    });

    // Refresh board after create
    await loadBoard(state);
  } catch (err) {
    console.error("[board] Failed to create ticket:", err);
    state.boardError = err instanceof Error ? err.message : "Failed to create ticket";
  }
}
