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
  type CodeLocation,
  type Ticket,
  type TicketCreateInput,
  type TicketUpdateInput,
  type TicketStatus,
  type TicketType,
  type BoardSummary,
  DEFAULT_BOARD_COLUMNS,
  DEFAULT_BOARD_SETTINGS,
  TICKET_STATUS_ORDER,
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

/** Slugify a title for use in branch names / worktree paths */
function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

/** Derive code location when an agent picks up a story */
function deriveCodeLocation(ticketId: string, title: string): CodeLocation {
  const slug = slugify(title);
  const idLower = ticketId.toLowerCase();
  return {
    branch: `story/${idLower}-${slug}`,
    worktree: `../wt-${idLower}-${slug}`,
  };
}

/** Map old ticket types to new ones during lazy migration */
const TYPE_MIGRATION: Record<string, TicketType> = {
  epic: "feature",
  story: "feature",
  task: "chore",
  bug: "bugfix",
  idea: "experiment",
  research: "experiment",
};

/** Lazy-migrate a raw ticket from old schema to new */
function migrateTicket(raw: Record<string, unknown>): Ticket {
  const ticket = raw as Ticket & Record<string, unknown>;

  // Migrate type
  const oldType = ticket.type as string;
  if (oldType && TYPE_MIGRATION[oldType]) {
    ticket.type = TYPE_MIGRATION[oldType];
  }

  // Migrate status: remove "blocked" → "backlog"
  if ((ticket.status as string) === "blocked") {
    ticket.status = "backlog";
  }

  // Migrate description → intent
  if (ticket.description && !ticket.intent) {
    ticket.intent = ticket.description as string;
  }

  // Migrate acceptanceCriteria → acceptanceSignal
  const ac = ticket.acceptanceCriteria as string[] | undefined;
  if (ac?.length && !ticket.acceptanceSignal) {
    ticket.acceptanceSignal = ac.join("\n");
  }

  // Migrate progressNotes → comments
  const pn = ticket.progressNotes as string[] | undefined;
  if (pn?.length && (!ticket.comments || ticket.comments.length === 0)) {
    ticket.comments = pn.map((text) => ({
      author: "system",
      text,
      createdAt: ticket.updatedAt ?? ticket.createdAt,
    }));
  }

  // Clean up removed fields
  delete ticket.description;
  delete ticket.acceptanceCriteria;
  delete ticket.progressNotes;
  delete ticket.rejectionCount;
  delete ticket.researchNotes;
  delete ticket.estimate;
  delete ticket.parentId;
  delete ticket.labels;
  delete ticket.tags;
  delete ticket.blockedBy;
  delete ticket.assignee;
  delete ticket.staleAt;

  return ticket as Ticket;
}

export async function ensureBoardDir(workspaceDir: string): Promise<string> {
  const boardDir = path.join(workspaceDir, BOARD_DIR);
  await fs.mkdir(boardDir, { recursive: true });
  await fs.mkdir(path.join(boardDir, TICKETS_DIR), { recursive: true });
  return boardDir;
}

export async function loadBoard(workspaceDir: string): Promise<Board | null> {
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

export async function saveBoard(workspaceDir: string, board: Board): Promise<void> {
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

  const timestamp = now();
  const board: Board = {
    id: sanitizeId(projectId),
    name: projectName,
    projectId: sanitizeId(projectId),
    projectName,
    columns: DEFAULT_BOARD_COLUMNS,
    settings: {
      ...DEFAULT_BOARD_SETTINGS,
      ticketPrefix: sanitizeId(projectId).slice(0, 4),
    },
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  await saveBoard(workspaceDir, board);
  return board;
}

export async function loadTicket(workspaceDir: string, ticketId: string): Promise<Ticket | null> {
  const boardDir = path.join(workspaceDir, BOARD_DIR);
  const filePath = ticketPath(boardDir, ticketId);

  try {
    const content = await fs.readFile(filePath, "utf-8");
    const raw = parseYamlSafe<Record<string, unknown>>(
      content,
      null as unknown as Record<string, unknown>,
    );
    if (!raw) {
      return null;
    }
    return migrateTicket(raw);
  } catch (err) {
    const anyErr = err as { code?: string };
    if (anyErr.code === "ENOENT") {
      return null;
    }
    throw err;
  }
}

export async function saveTicket(workspaceDir: string, ticket: Ticket): Promise<void> {
  const boardDir = await ensureBoardDir(workspaceDir);
  const filePath = ticketPath(boardDir, ticket.id);
  const content = yaml.stringify(ticket, { lineWidth: 120 });
  await fs.writeFile(filePath, content, "utf-8");
}

export async function deleteTicket(workspaceDir: string, ticketId: string): Promise<boolean> {
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
        const raw = parseYamlSafe<Record<string, unknown>>(
          content,
          null as unknown as Record<string, unknown>,
        );
        if (raw && (raw as { id?: string }).id) {
          tickets.push(migrateTicket(raw));
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

export async function loadBoardWithTickets(workspaceDir: string): Promise<BoardWithTickets | null> {
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
    title: input.title,
    type: input.type ?? "feature",
    status: "backlog",
    intent: input.intent,
    acceptanceSignal: input.acceptanceSignal,
    comments: [],
    createdAt: timestamp,
    updatedAt: timestamp,
    statusChangedAt: timestamp,
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

  // Append move note as a comment
  const comments = ticket.comments ?? [];
  if (note) {
    comments.push({
      author: "system",
      text: `Moved to ${toStatus}: ${note}`,
      createdAt: timestamp,
    });
  }

  // Derive codeLocation when moving to in-progress
  const codeLocation =
    toStatus === "in-progress" && !ticket.codeLocation
      ? deriveCodeLocation(ticket.id, ticket.title)
      : ticket.codeLocation;

  const updated: Ticket = {
    ...ticket,
    status: toStatus,
    updatedAt: timestamp,
    statusChangedAt: timestamp,
    completedAt: toStatus === "done" ? timestamp : ticket.completedAt,
    comments,
    codeLocation,
  };

  await saveTicket(workspaceDir, updated);
  return updated;
}

export async function addComment(
  workspaceDir: string,
  ticketId: string,
  author: string,
  text: string,
): Promise<Ticket> {
  const ticket = await loadTicket(workspaceDir, ticketId);
  if (!ticket) {
    throw new Error(`Ticket not found: ${ticketId}`);
  }

  const timestamp = now();
  const comments = ticket.comments ?? [];
  comments.push({ author, text, createdAt: timestamp });

  const updated: Ticket = {
    ...ticket,
    comments,
    updatedAt: timestamp,
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
    .toSorted((a, b) => {
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });
}

export async function getStaleTickets(workspaceDir: string, maxHours: number): Promise<Ticket[]> {
  const tickets = await listTickets(workspaceDir);
  const cutoff = Date.now() - maxHours * 60 * 60 * 1000;

  return tickets.filter(
    (t) =>
      t.status === "in-progress" &&
      t.statusChangedAt &&
      new Date(t.statusChangedAt).getTime() < cutoff,
  );
}

export async function getBoardSummary(workspaceDir: string): Promise<BoardSummary | null> {
  const board = await loadBoard(workspaceDir);
  if (!board) {
    return null;
  }

  const tickets = await listTickets(workspaceDir);

  const columnCounts = {} as Record<TicketStatus, number>;
  for (const status of Object.keys(TICKET_STATUS_ORDER) as TicketStatus[]) {
    columnCounts[status] = tickets.filter((t) => t.status === status).length;
  }

  const staleTickets = await getStaleTickets(workspaceDir, board.settings.staleInProgressHours);

  const backlogTickets = tickets
    .filter((t) => t.status === "backlog")
    .toSorted((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  const inProgressTickets = tickets
    .filter((t) => t.status === "in-progress")
    .toSorted((a, b) => {
      const aTime = a.statusChangedAt ? new Date(a.statusChangedAt).getTime() : 0;
      const bTime = b.statusChangedAt ? new Date(b.statusChangedAt).getTime() : 0;
      return aTime - bTime;
    });

  const oldestBacklogAgeMs = backlogTickets[0]
    ? Date.now() - new Date(backlogTickets[0].createdAt).getTime()
    : null;

  const oldestInProgressAgeMs = inProgressTickets[0]?.statusChangedAt
    ? Date.now() - new Date(inProgressTickets[0].statusChangedAt).getTime()
    : null;

  return {
    id: board.id,
    name: board.name,
    projectName: board.projectName,
    ticketCount: tickets.length,
    totalTickets: tickets.length,
    openCount: tickets.filter((t) => t.status !== "done").length,
    completedCount: tickets.filter((t) => t.status === "done").length,
    staleCount: staleTickets.length,
    oldestBacklogAge: oldestBacklogAgeMs,
    oldestInProgressAge: oldestInProgressAgeMs,
    columnCounts,
  };
}

export async function getNextWorkItem(workspaceDir: string): Promise<Ticket | null> {
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

  // Get first ready item (sorted by creation date)
  const ready = await getTicketsByStatus(workspaceDir, "ready");
  return ready[0] ?? null;
}
