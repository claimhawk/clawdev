import { beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  initBoard,
  loadBoard,
  createTicket,
  loadTicket,
  updateTicket,
  moveTicket,
  deleteTicket,
  listTickets,
  getTicketsByStatus,
  getBoardSummary,
  getNextWorkItem,
  getNextRefinementItem,
  getStaleTickets,
  getBlockedTickets,
  getChildTickets,
} from "./storage.js";

describe("Board Storage", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), "board-test-"));
  });

  describe("initBoard", () => {
    it("creates a new board", async () => {
      const board = await initBoard(testDir, "test-project", "Test Project");

      expect(board.projectId).toBe("TEST-PROJECT");
      expect(board.projectName).toBe("Test Project");
      expect(board.settings.ticketPrefix).toBe("TEST");
      expect(board.columns.length).toBe(6);
    });

    it("returns existing board if already initialized", async () => {
      const first = await initBoard(testDir, "proj1", "Project One");
      const second = await initBoard(testDir, "proj2", "Project Two");

      expect(second.projectId).toBe(first.projectId);
    });
  });

  describe("loadBoard", () => {
    it("returns null for non-existent board", async () => {
      const board = await loadBoard(testDir);
      expect(board).toBeNull();
    });

    it("loads existing board", async () => {
      await initBoard(testDir, "test", "Test");
      const board = await loadBoard(testDir);

      expect(board).not.toBeNull();
      expect(board?.projectId).toBe("TEST");
    });
  });

  describe("createTicket", () => {
    it("creates a ticket with auto-generated ID", async () => {
      await initBoard(testDir, "test", "Test");
      const ticket = await createTicket(testDir, {
        title: "Fix the bug",
        type: "bug",
        priority: "high",
      });

      expect(ticket.id).toBe("TEST-001");
      expect(ticket.title).toBe("Fix the bug");
      expect(ticket.type).toBe("bug");
      expect(ticket.priority).toBe("high");
      expect(ticket.status).toBe("backlog");
    });

    it("increments ticket numbers", async () => {
      await initBoard(testDir, "test", "Test");
      const first = await createTicket(testDir, { title: "First" });
      const second = await createTicket(testDir, { title: "Second" });

      expect(first.id).toBe("TEST-001");
      expect(second.id).toBe("TEST-002");
    });

    it("throws if board not initialized", async () => {
      await expect(
        createTicket(testDir, { title: "Test" }),
      ).rejects.toThrow("Board not initialized");
    });
  });

  describe("updateTicket", () => {
    it("updates ticket fields", async () => {
      await initBoard(testDir, "test", "Test");
      const ticket = await createTicket(testDir, { title: "Original" });

      const updated = await updateTicket(testDir, ticket.id, {
        title: "Updated",
        priority: "critical",
        researchNotes: "Found something interesting",
      });

      expect(updated.title).toBe("Updated");
      expect(updated.priority).toBe("critical");
      expect(updated.researchNotes).toBe("Found something interesting");
      expect(updated.status).toBe("backlog"); // Status unchanged
    });

    it("throws for non-existent ticket", async () => {
      await initBoard(testDir, "test", "Test");
      await expect(
        updateTicket(testDir, "FAKE-999", { title: "Test" }),
      ).rejects.toThrow("Ticket not found");
    });
  });

  describe("moveTicket", () => {
    it("moves ticket to new status", async () => {
      await initBoard(testDir, "test", "Test");
      const ticket = await createTicket(testDir, { title: "Test" });

      const moved = await moveTicket(testDir, ticket.id, "ready");

      expect(moved.status).toBe("ready");
      expect(moved.statusChangedAt).not.toBe(ticket.statusChangedAt);
    });

    it("records completion timestamp when moved to done", async () => {
      await initBoard(testDir, "test", "Test");
      const ticket = await createTicket(testDir, { title: "Test" });
      await moveTicket(testDir, ticket.id, "in-progress");
      await moveTicket(testDir, ticket.id, "review");

      const done = await moveTicket(testDir, ticket.id, "done");

      expect(done.completedAt).toBeDefined();
    });

    it("increments rejection count when moved from review", async () => {
      await initBoard(testDir, "test", "Test");
      const ticket = await createTicket(testDir, { title: "Test" });
      await moveTicket(testDir, ticket.id, "review");

      const rejected = await moveTicket(testDir, ticket.id, "in-progress");

      expect(rejected.rejectionCount).toBe(1);
    });
  });

  describe("deleteTicket", () => {
    it("deletes existing ticket", async () => {
      await initBoard(testDir, "test", "Test");
      const ticket = await createTicket(testDir, { title: "Test" });

      const deleted = await deleteTicket(testDir, ticket.id);

      expect(deleted).toBe(true);
      expect(await loadTicket(testDir, ticket.id)).toBeNull();
    });

    it("returns false for non-existent ticket", async () => {
      await initBoard(testDir, "test", "Test");
      const deleted = await deleteTicket(testDir, "FAKE-999");
      expect(deleted).toBe(false);
    });
  });

  describe("listTickets", () => {
    it("returns all tickets", async () => {
      await initBoard(testDir, "test", "Test");
      await createTicket(testDir, { title: "One" });
      await createTicket(testDir, { title: "Two" });
      await createTicket(testDir, { title: "Three" });

      const tickets = await listTickets(testDir);

      expect(tickets.length).toBe(3);
    });
  });

  describe("getTicketsByStatus", () => {
    it("filters by status and sorts by priority", async () => {
      await initBoard(testDir, "test", "Test");
      await createTicket(testDir, { title: "Low", priority: "low" });
      await createTicket(testDir, { title: "High", priority: "high" });
      await createTicket(testDir, { title: "Critical", priority: "critical" });

      const tickets = await getTicketsByStatus(testDir, "backlog");

      expect(tickets.length).toBe(3);
      expect(tickets[0].priority).toBe("critical");
      expect(tickets[1].priority).toBe("high");
      expect(tickets[2].priority).toBe("low");
    });
  });

  describe("getBoardSummary", () => {
    it("returns column counts and health metrics", async () => {
      await initBoard(testDir, "test", "Test");
      await createTicket(testDir, { title: "Backlog 1" });
      await createTicket(testDir, { title: "Backlog 2" });
      const t3 = await createTicket(testDir, { title: "Ready" });
      await moveTicket(testDir, t3.id, "ready");

      const summary = await getBoardSummary(testDir);

      expect(summary?.columnCounts.backlog).toBe(2);
      expect(summary?.columnCounts.ready).toBe(1);
      expect(summary?.totalTickets).toBe(3);
    });
  });

  describe("getNextWorkItem", () => {
    it("returns highest priority ready item", async () => {
      await initBoard(testDir, "test", "Test");
      const low = await createTicket(testDir, { title: "Low", priority: "low" });
      const high = await createTicket(testDir, { title: "High", priority: "high" });
      await moveTicket(testDir, low.id, "ready");
      await moveTicket(testDir, high.id, "ready");

      const next = await getNextWorkItem(testDir);

      expect(next?.id).toBe(high.id);
    });

    it("returns null when at WIP limit", async () => {
      await initBoard(testDir, "test", "Test");
      // Create and move 2 tickets to in-progress (WIP limit)
      const t1 = await createTicket(testDir, { title: "T1" });
      const t2 = await createTicket(testDir, { title: "T2" });
      const t3 = await createTicket(testDir, { title: "T3" });
      await moveTicket(testDir, t1.id, "in-progress");
      await moveTicket(testDir, t2.id, "in-progress");
      await moveTicket(testDir, t3.id, "ready");

      const next = await getNextWorkItem(testDir);

      expect(next).toBeNull();
    });
  });

  describe("getNextRefinementItem", () => {
    it("prioritizes epics and stories", async () => {
      await initBoard(testDir, "test", "Test");
      await createTicket(testDir, { title: "Task", type: "task" });
      const epic = await createTicket(testDir, { title: "Epic", type: "epic" });

      const next = await getNextRefinementItem(testDir);

      expect(next?.id).toBe(epic.id);
    });
  });

  describe("getChildTickets", () => {
    it("returns tickets with matching parentId", async () => {
      await initBoard(testDir, "test", "Test");
      const parent = await createTicket(testDir, { title: "Parent", type: "epic" });
      await createTicket(testDir, { title: "Child 1", parentId: parent.id });
      await createTicket(testDir, { title: "Child 2", parentId: parent.id });
      await createTicket(testDir, { title: "Unrelated" });

      const children = await getChildTickets(testDir, parent.id);

      expect(children.length).toBe(2);
      expect(children.every((t) => t.parentId === parent.id)).toBe(true);
    });
  });
});
