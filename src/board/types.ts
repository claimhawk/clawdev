export type TicketType = "feature" | "bugfix" | "chore" | "experiment";
export type TicketStatus = "backlog" | "ready" | "in-progress" | "review" | "done";
export type TicketPriority = "critical" | "high" | "medium" | "low";
export type AssigneeType = "human" | "agent";

export type Assignee = {
  type: AssigneeType;
  id: string;
  name: string;
};

export type Comment = {
  author: string;
  text: string;
  createdAt: string;
};

export type CodeLocation = {
  branch: string;
  worktree: string;
};

export type Ticket = {
  id: string;
  title: string;
  type: TicketType;
  status: TicketStatus;
  priority?: TicketPriority;
  intent?: string;
  acceptanceSignal?: string;
  comments?: Comment[];
  codeLocation?: CodeLocation;
  createdAt: string;
  updatedAt: string;
  createdBy?: Assignee;
  statusChangedAt?: string;
  completedAt?: string;
};

export type TicketCreateInput = {
  title: string;
  type?: TicketType;
  intent?: string;
  acceptanceSignal?: string;
};

export type TicketUpdateInput = Partial<Omit<Ticket, "id" | "createdAt" | "createdBy">>;

export type BoardSettings = {
  defaultPriority: TicketPriority;
  defaultType: TicketType;
  autoAssign: boolean;
  staleThresholdDays: number;
  ticketPrefix: string;
  nextTicketNumber: number;
  staleInProgressHours: number;
};

export type Board = {
  id: string;
  name: string;
  projectId: string;
  projectName: string;
  description?: string;
  columns: BoardColumn[];
  settings: BoardSettings;
  createdAt: string;
  updatedAt: string;
};

export type BoardColumn = {
  id: TicketStatus;
  name: string;
  wipLimit: number | null;
};

export type BoardWithTickets = Board & {
  tickets: Ticket[];
};

export type BoardSummary = {
  id: string;
  name: string;
  projectName: string;
  ticketCount: number;
  totalTickets: number;
  openCount: number;
  completedCount: number;
  staleCount: number;
  oldestBacklogAge: number | null;
  oldestInProgressAge: number | null;
  columnCounts: Record<TicketStatus, number>;
};

export type BoardConfig = {
  projectId: string;
  projectName: string;
  columns: {
    id: TicketStatus;
    name: string;
    wipLimit: number | null;
  }[];
  members: Assignee[];
};

export type BoardData = {
  config: BoardConfig;
  tickets: Ticket[];
};

export const DEFAULT_COLUMNS: BoardConfig["columns"] = [
  { id: "backlog", name: "Backlog", wipLimit: null },
  { id: "ready", name: "Ready", wipLimit: 10 },
  { id: "in-progress", name: "In Progress", wipLimit: 2 },
  { id: "review", name: "Review", wipLimit: 5 },
  { id: "done", name: "Done", wipLimit: null },
];

export const DEFAULT_BOARD_COLUMNS: BoardColumn[] = [
  { id: "backlog", name: "Backlog", wipLimit: null },
  { id: "ready", name: "Ready", wipLimit: 10 },
  { id: "in-progress", name: "In Progress", wipLimit: 2 },
  { id: "review", name: "Review", wipLimit: 5 },
  { id: "done", name: "Done", wipLimit: null },
];

export const DEFAULT_BOARD_SETTINGS: BoardSettings = {
  defaultPriority: "medium",
  defaultType: "feature",
  autoAssign: false,
  staleThresholdDays: 7,
  ticketPrefix: "TICKET",
  nextTicketNumber: 1,
  staleInProgressHours: 48,
};

export const VALID_STATUSES: TicketStatus[] = ["backlog", "ready", "in-progress", "review", "done"];

export const TICKET_STATUS_ORDER: Record<TicketStatus, number> = {
  backlog: 0,
  ready: 1,
  "in-progress": 2,
  review: 3,
  done: 4,
};

export const VALID_TYPES: TicketType[] = ["feature", "bugfix", "chore", "experiment"];

export const VALID_PRIORITIES: TicketPriority[] = ["critical", "high", "medium", "low"];

export const TICKET_PRIORITY_ORDER: Record<TicketPriority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};
