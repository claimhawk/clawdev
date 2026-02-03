/**
 * Project Board System Types
 *
 * A Kanban-style board system for autonomous agent work.
 * Boards live in agent workspaces and track tickets through columns.
 */

export type TicketType = "epic" | "story" | "task" | "bug" | "research";

export type TicketPriority = "critical" | "high" | "medium" | "low";

export type TicketStatus =
  | "backlog" // Vague ideas, needs refinement
  | "refinement" // Being broken down into concrete tasks
  | "ready" // Refined, ready to work
  | "in-progress" // Currently being worked on
  | "review" // Completed, needs verification
  | "done" // Verified complete
  | "blocked"; // Waiting on external dependency

export type Ticket = {
  /** Unique ticket ID (e.g., "SEC-001", "PROJ-042") */
  id: string;

  /** Parent ticket ID for subtasks (e.g., epic → story → task) */
  parentId?: string;

  /** Human-readable title */
  title: string;

  /** Ticket classification */
  type: TicketType;

  /** Current column/status */
  status: TicketStatus;

  /** Work priority */
  priority: TicketPriority;

  /** Detailed description of the work */
  description: string;

  /** Concrete criteria for completion */
  acceptanceCriteria: string[];

  /** Research notes accumulated during work */
  researchNotes?: string;

  /** Progress notes from work sessions */
  progressNotes?: string;

  /** Estimated effort (e.g., "2h", "1d", "3d") */
  estimate?: string;

  /** Actual effort spent */
  actualEffort?: string;

  /** IDs of tickets this blocks */
  blocks?: string[];

  /** IDs of tickets blocking this */
  blockedBy?: string[];

  /** Tags for categorization */
  tags?: string[];

  /** Agent ID that owns this ticket */
  assignee?: string;

  /** ISO timestamp of creation */
  createdAt: string;

  /** ISO timestamp of last update */
  updatedAt: string;

  /** ISO timestamp when moved to current status */
  statusChangedAt: string;

  /** ISO timestamp of completion (status=done) */
  completedAt?: string;

  /** Number of times moved back from review */
  rejectionCount?: number;

  /** Source of the ticket (user, agent, refinement) */
  source?: "user" | "agent" | "refinement";
};

export type BoardColumn = {
  /** Column identifier matching TicketStatus */
  id: TicketStatus;

  /** Display name */
  name: string;

  /** Maximum tickets allowed (null = unlimited) */
  wipLimit: number | null;

  /** Whether agent can auto-pull tickets into this column */
  autoPull?: boolean;
};

export type BoardSettings = {
  /** Auto-refine backlog items during heartbeat */
  autoRefine: boolean;

  /** Auto-work ready items during heartbeat */
  autoWork: boolean;

  /** Require review before done */
  requireReview: boolean;

  /** Maximum hours a ticket can be in-progress before stale warning */
  staleInProgressHours: number;

  /** Maximum tickets to refine per heartbeat */
  maxRefinePerHeartbeat: number;

  /** Maximum tickets to work per heartbeat */
  maxWorkPerHeartbeat: number;

  /** Prefix for auto-generated ticket IDs */
  ticketPrefix: string;

  /** Next ticket number for auto-generation */
  nextTicketNumber: number;
};

export type Board = {
  /** Schema version for migrations */
  version: number;

  /** Project identifier */
  projectId: string;

  /** Human-readable project name */
  projectName: string;

  /** Board columns configuration */
  columns: BoardColumn[];

  /** Board behavior settings */
  settings: BoardSettings;

  /** ISO timestamp of last board modification */
  updatedAt: string;
};

export type BoardWithTickets = Board & {
  /** All tickets on the board */
  tickets: Ticket[];
};

export type TicketCreateInput = {
  title: string;
  type?: TicketType;
  priority?: TicketPriority;
  description?: string;
  acceptanceCriteria?: string[];
  parentId?: string;
  tags?: string[];
  estimate?: string;
};

export type TicketUpdateInput = {
  title?: string;
  type?: TicketType;
  priority?: TicketPriority;
  description?: string;
  acceptanceCriteria?: string[];
  researchNotes?: string;
  progressNotes?: string;
  estimate?: string;
  actualEffort?: string;
  tags?: string[];
  blocks?: string[];
  blockedBy?: string[];
};

export type TicketMoveInput = {
  ticketId: string;
  toStatus: TicketStatus;
  note?: string;
};

export type RefinementResult = {
  epicId: string;
  createdTickets: Ticket[];
  researchNotes: string;
};

export type BoardSummary = {
  projectId: string;
  projectName: string;
  columnCounts: Record<TicketStatus, number>;
  blockedCount: number;
  staleCount: number;
  totalTickets: number;
  oldestBacklogAge?: string;
  oldestInProgressAge?: string;
};

/** Default board configuration */
export const DEFAULT_BOARD_COLUMNS: BoardColumn[] = [
  { id: "backlog", name: "Backlog", wipLimit: null },
  { id: "refinement", name: "Refinement", wipLimit: 3 },
  { id: "ready", name: "Ready", wipLimit: 10 },
  { id: "in-progress", name: "In Progress", wipLimit: 2, autoPull: true },
  { id: "review", name: "Review", wipLimit: 5 },
  { id: "done", name: "Done", wipLimit: null },
];

export const DEFAULT_BOARD_SETTINGS: BoardSettings = {
  autoRefine: true,
  autoWork: true,
  requireReview: true,
  staleInProgressHours: 24,
  maxRefinePerHeartbeat: 1,
  maxWorkPerHeartbeat: 1,
  ticketPrefix: "TASK",
  nextTicketNumber: 1,
};

export const TICKET_STATUS_ORDER: TicketStatus[] = [
  "backlog",
  "refinement",
  "ready",
  "in-progress",
  "review",
  "done",
  "blocked",
];

export const TICKET_PRIORITY_ORDER: TicketPriority[] = [
  "critical",
  "high",
  "medium",
  "low",
];
