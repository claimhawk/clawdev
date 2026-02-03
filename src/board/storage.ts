/**
 * Board Storage Layer
 *
 * Persists boards and tickets to the agent workspace.
 * Structure:
 *   <workspace>/board/
 *     board.yaml       - Board configuration
 *     tickets/
 *       <id>.yaml      - Individual ticket files
 */

import fs from "node:fs/promises";
import path from "node:path";
import yaml from "yaml";
import {
  type Board,
  type BoardWithTickets,
  type Ticket,
  type TicketCreateInput,
  type TicketUpdateInput,
  type TicketStatus,
  type BoardSummary,
  DEFAULT_BOARD_COLUMNS,
  DEFAULT_BOARD_SETTINGS,
  TICKET_STATUS_ORDER,
  TICKET_PRIORITY_ORDER,
} from "./types.js";

const BOARD_DIR = "board";
const BOARD_FILE = "board.yaml";
const TICKETS_DIR = "tickets";

export type BoardStorageOptions = {
  workspaceDir: string;
};

function now(): string {
  return new Date().toISOString();
}

function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "_").toUpperCase();
}

function ticketPath(boardDir: string, ticketId: string): string {
  return path.join(boardDir, TICKETS_DIR, `${sanitizeId(ticketId)}.yaml`);
}

function parseYamlSafe<T>(content: string, fallback: T): T {
  try {
    return yaml.parse(content) as T;
  } catch {
    return fallback;
  }
}

function ageString(isoDate: string): string {
  const ms = Date.now() - new Date(isoDate).getTime();
  const hours = Math.floor(ms / (1000 * 60 * 60));
  if (hours < 24) {
    return `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

export async function ensureBoardDir(workspaceDir: string): Promise<string> {
  const boardDir = path.join(workspaceDir, BOARD_DIR);
  await fs.mkdir(boardDir, { recursive: true });
  await fs.mkdir(path.join(boardDir, TICKETS_DIR), { recursive: true });
  return boardDir;
}

export async function loadBoard(
  workspaceDir: string,
): Promise<Board | null> {
  const boardDir = path.join(workspaceDir, BOARD_DIR);
  const boardPath = path.join(boardDir, BOARD_FILE);

  try {
    const content = await fs.readFile(boardPath, "utf-8");
    return parseYamlSafe<Board>(content, null as unknown as Board);
  } catch (err) {
    const anyErr = err as { code?: string };
    if (anyErr.code === "ENOENT") {
      return null;
    }
    throw err;
  }
}

export async function saveBoard(
  workspaceDir: string,
  board: Board,
): Promise<void> {
  const boardDir = await ensureBoardDir(workspaceDir);
  const boardPath = path.join(boardDir, BOARD_FILE);
  const content = yaml.stringify(board, { lineWidth: 120 });
  await fs.writeFile(boardPath, content, "utf-8");
}

export async function initBoard(
  workspaceDir: string,
  projectId: string,
  projectName: string,
): Promise<Board> {
  const existing = await loadBoard(workspaceDir);
  if (existing) {
    return existing;
  }

  const board: Board = {
    version: 1,
    projectId: sanitizeId(projectId),
    projectName,
    columns: DEFAULT_BOARD_COLUMNS,
    settings: {
      ...DEFAULT_BOARD_SETTINGS,
      ticketPrefix: sanitizeId(projectId).slice(0, 4),
    },
    updatedAt: now(),
  };

  await saveBoard(workspaceDir, board);
  return board;
}

export async function loadTicket(
  workspaceDir: string,
  ticketId: string,
): Promise<Ticket | null> {
  const boardDir = path.join(workspaceDir, BOARD_DIR);
  const filePath = ticketPath(boardDir, ticketId);

  try {
    const content = await fs.readFile(filePath, "utf-8");
    return parseYamlSafe<Ticket>(content, null as unknown as Ticket);
  } catch (err) {
    const anyErr = err as { code?: string };
    if (anyErr.code === "ENOENT") {
      return null;
    }
    throw err;
  }
}

export async function saveTicket(
  workspaceDir: string,
  ticket: Ticket,
): Promise<void> {
  const boardDir = await ensureBoardDir(workspaceDir);
  const filePath = ticketPath(boardDir, ticket.id);
  const content = yaml.stringify(ticket, { lineWidth: 120 });
  await fs.writeFile(filePath, content, "utf-8");
}

export async function deleteTicket(
  workspaceDir: string,
  ticketId: string,
): Promise<boolean> {
  const boardDir = path.join(workspaceDir, BOARD_DIR);
  const filePath = ticketPath(boardDir, ticketId);

  try {
    await fs.unlink(filePath);
    return true;
  } catch (err) {
    const anyErr = err as { code?: string };
    if (anyErr.code === "ENOENT") {
      return false;
    }
    throw err;
  }
}

export async function listTickets(workspaceDir: string): Promise<Ticket[]> {
  const boardDir = path.join(workspaceDir, BOARD_DIR);
  const ticketsDir = path.join(boardDir, TICKETS_DIR);

  try {
    const files = await fs.readdir(ticketsDir);
    const yamlFiles = files.filter((f) => f.endsWith(".yaml"));

    const tickets: Ticket[] = [];
    for (const file of yamlFiles) {
      try {
        const content = await fs.readFile(path.join(ticketsDir, file), "utf-8");
        const ticket = parseYamlSafe<Ticket>(content, null as unknown as Ticket);
        if (ticket?.id) {
          tickets.push(ticket);
        }
      } catch {
        // Skip invalid ticket files
      }
    }

    return tickets;
  } catch (err) {
    const anyErr = err as { code?: string };
    if (anyErr.code === "ENOENT") {
      return [];
    }
    throw err;
  }
}

export async function loadBoardWithTickets(
  workspaceDir: string,
): Promise<BoardWithTickets | null> {
  const board = await loadBoard(workspaceDir);
  if (!board) {
    return null;
  }

  const tickets = await listTickets(workspaceDir);
  return { ...board, tickets };
}

export async function createTicket(
  workspaceDir: string,
  input: TicketCreateInput,
): Promise<Ticket> {
  const board = await loadBoard(workspaceDir);
  if (!board) {
    throw new Error("Board not initialized. Run board_init first.");
  }

  // Generate ticket ID
  const ticketId = `${board.settings.ticketPrefix}-${String(board.settings.nextTicketNumber).padStart(3, "0")}`;
  board.settings.nextTicketNumber++;
  board.updatedAt = now();

  const timestamp = now();
  const ticket: Ticket = {
    id: ticketId,
    parentId: input.parentId,
    title: input.title,
    type: input.type ?? "task",
    status: "backlog",
    priority: input.priority ?? "medium",
    description: input.description ?? "",
    acceptanceCriteria: input.acceptanceCriteria ?? [],
    tags: input.tags,
    estimate: input.estimate,
    createdAt: timestamp,
    updatedAt: timestamp,
    statusChangedAt: timestamp,
    source: "user",
  };

  await saveBoard(workspaceDir, board);
  await saveTicket(workspaceDir, ticket);
  return ticket;
}

export async function updateTicket(
  workspaceDir: string,
  ticketId: string,
  input: TicketUpdateInput,
): Promise<Ticket> {
  const ticket = await loadTicket(workspaceDir, ticketId);
  if (!ticket) {
    throw new Error(`Ticket not found: ${ticketId}`);
  }

  const updated: Ticket = {
    ...ticket,
    ...input,
    id: ticket.id, // Prevent ID change
    status: ticket.status, // Use moveTicket for status changes
    createdAt: ticket.createdAt, // Preserve creation time
    updatedAt: now(),
  };

  await saveTicket(workspaceDir, updated);
  return updated;
}

export async function moveTicket(
  workspaceDir: string,
  ticketId: string,
  toStatus: TicketStatus,
  note?: string,
): Promise<Ticket> {
  const ticket = await loadTicket(workspaceDir, ticketId);
  if (!ticket) {
    throw new Error(`Ticket not found: ${ticketId}`);
  }

  const board = await loadBoard(workspaceDir);
  if (!board) {
    throw new Error("Board not initialized");
  }

  // Check WIP limits
  const targetColumn = board.columns.find((c) => c.id === toStatus);
  if (targetColumn?.wipLimit) {
    const tickets = await listTickets(workspaceDir);
    const inColumn = tickets.filter((t) => t.status === toStatus && t.id !== ticketId);
    if (inColumn.length >= targetColumn.wipLimit) {
      throw new Error(
        `WIP limit reached for ${toStatus}: ${inColumn.length}/${targetColumn.wipLimit}`,
      );
    }
  }

  const timestamp = now();
  const fromReview = ticket.status === "review" && toStatus !== "done";

  const updated: Ticket = {
    ...ticket,
    status: toStatus,
    updatedAt: timestamp,
    statusChangedAt: timestamp,
    completedAt: toStatus === "done" ? timestamp : ticket.completedAt,
    rejectionCount: fromReview
      ? (ticket.rejectionCount ?? 0) + 1
      : ticket.rejectionCount,
    progressNotes: note
      ? `${ticket.progressNotes ?? ""}\n\n[${timestamp}] Moved to ${toStatus}: ${note}`.trim()
      : ticket.progressNotes,
  };

  await saveTicket(workspaceDir, updated);
  return updated;
}

export async function getTicketsByStatus(
  workspaceDir: string,
  status: TicketStatus,
): Promise<Ticket[]> {
  const tickets = await listTickets(workspaceDir);
  return tickets
    .filter((t) => t.status === status)
    .sort((a, b) => {
      // Sort by priority first, then by creation date
      const priorityDiff =
        TICKET_PRIORITY_ORDER.indexOf(a.priority) -
        TICKET_PRIORITY_ORDER.indexOf(b.priority);
      if (priorityDiff !== 0) {
        return priorityDiff;
      }
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });
}

export async function getStaleTickets(
  workspaceDir: string,
  maxHours: number,
): Promise<Ticket[]> {
  const tickets = await listTickets(workspaceDir);
  const cutoff = Date.now() - maxHours * 60 * 60 * 1000;

  return tickets.filter(
    (t) =>
      t.status === "in-progress" &&
      new Date(t.statusChangedAt).getTime() < cutoff,
  );
}

export async function getBlockedTickets(workspaceDir: string): Promise<Ticket[]> {
  const tickets = await listTickets(workspaceDir);
  const ticketIds = new Set(tickets.map((t) => t.id));

  return tickets.filter((t) => {
    if (t.status === "blocked") {
      return true;
    }
    // Check if blocked by unfinished tickets
    if (t.blockedBy?.length) {
      return t.blockedBy.some((blockerId) => {
        const blocker = tickets.find((bt) => bt.id === blockerId);
        return blocker && blocker.status !== "done";
      });
    }
    return false;
  });
}

export async function getBoardSummary(
  workspaceDir: string,
): Promise<BoardSummary | null> {
  const board = await loadBoard(workspaceDir);
  if (!board) {
    return null;
  }

  const tickets = await listTickets(workspaceDir);

  const columnCounts = {} as Record<TicketStatus, number>;
  for (const status of TICKET_STATUS_ORDER) {
    columnCounts[status] = tickets.filter((t) => t.status === status).length;
  }

  const blockedTickets = await getBlockedTickets(workspaceDir);
  const staleTickets = await getStaleTickets(
    workspaceDir,
    board.settings.staleInProgressHours,
  );

  const backlogTickets = tickets
    .filter((t) => t.status === "backlog")
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  const inProgressTickets = tickets
    .filter((t) => t.status === "in-progress")
    .sort(
      (a, b) =>
        new Date(a.statusChangedAt).getTime() - new Date(b.statusChangedAt).getTime(),
    );

  return {
    projectId: board.projectId,
    projectName: board.projectName,
    columnCounts,
    blockedCount: blockedTickets.length,
    staleCount: staleTickets.length,
    totalTickets: tickets.length,
    oldestBacklogAge: backlogTickets[0]
      ? ageString(backlogTickets[0].createdAt)
      : undefined,
    oldestInProgressAge: inProgressTickets[0]
      ? ageString(inProgressTickets[0].statusChangedAt)
      : undefined,
  };
}

export async function getNextWorkItem(
  workspaceDir: string,
): Promise<Ticket | null> {
  const board = await loadBoard(workspaceDir);
  if (!board) {
    return null;
  }

  // Check WIP limit for in-progress
  const inProgressColumn = board.columns.find((c) => c.id === "in-progress");
  if (inProgressColumn?.wipLimit) {
    const inProgress = await getTicketsByStatus(workspaceDir, "in-progress");
    if (inProgress.length >= inProgressColumn.wipLimit) {
      return null; // At capacity
    }
  }

  // Get highest priority ready item
  const ready = await getTicketsByStatus(workspaceDir, "ready");
  return ready[0] ?? null;
}

export async function getNextRefinementItem(
  workspaceDir: string,
): Promise<Ticket | null> {
  const board = await loadBoard(workspaceDir);
  if (!board) {
    return null;
  }

  // Check WIP limit for refinement
  const refinementColumn = board.columns.find((c) => c.id === "refinement");
  if (refinementColumn?.wipLimit) {
    const inRefinement = await getTicketsByStatus(workspaceDir, "refinement");
    if (inRefinement.length >= refinementColumn.wipLimit) {
      return null; // At capacity
    }
  }

  // Get oldest backlog item (epics/stories first)
  const backlog = await getTicketsByStatus(workspaceDir, "backlog");
  const epicsAndStories = backlog.filter(
    (t) => t.type === "epic" || t.type === "story",
  );

  return epicsAndStories[0] ?? backlog[0] ?? null;
}

export async function getChildTickets(
  workspaceDir: string,
  parentId: string,
): Promise<Ticket[]> {
  const tickets = await listTickets(workspaceDir);
  return tickets.filter((t) => t.parentId === parentId);
}
