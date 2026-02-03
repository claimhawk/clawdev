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
  getStaleTickets,
  addComment,
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
      expect(board.columns.length).toBe(5);
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
        type: "bugfix",
      });

      expect(ticket.id).toBe("TEST-001");
      expect(ticket.title).toBe("Fix the bug");
      expect(ticket.type).toBe("bugfix");
      expect(ticket.status).toBe("backlog");
      expect(ticket.comments).toEqual([]);
    });

    it("increments ticket numbers", async () => {
      await initBoard(testDir, "test", "Test");
      const first = await createTicket(testDir, { title: "First" });
      const second = await createTicket(testDir, { title: "Second" });

      expect(first.id).toBe("TEST-001");
      expect(second.id).toBe("TEST-002");
    });

    it("defaults type to feature", async () => {
      await initBoard(testDir, "test", "Test");
      const ticket = await createTicket(testDir, { title: "New thing" });

      expect(ticket.type).toBe("feature");
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
        intent: "Build the feature",
      });

      expect(updated.title).toBe("Updated");
      expect(updated.intent).toBe("Build the feature");
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

    it("appends note as comment when moving", async () => {
      await initBoard(testDir, "test", "Test");
      const ticket = await createTicket(testDir, { title: "Test" });

      const moved = await moveTicket(testDir, ticket.id, "ready", "Refined and ready");

      expect(moved.comments).toHaveLength(1);
      expect(moved.comments![0].text).toContain("Refined and ready");
      expect(moved.comments![0].author).toBe("system");
    });

    it("derives codeLocation when moving to in-progress", async () => {
      await initBoard(testDir, "test", "Test");
      const ticket = await createTicket(testDir, { title: "Add user auth" });
      await moveTicket(testDir, ticket.id, "ready");

      const inProgress = await moveTicket(testDir, ticket.id, "in-progress");

      expect(inProgress.codeLocation).toBeDefined();
      expect(inProgress.codeLocation!.branch).toMatch(/^story\/test-001-add-user-auth/);
      expect(inProgress.codeLocation!.worktree).toMatch(/^\.\.\/wt-test-001-add-user-auth/);
    });

    it("preserves existing codeLocation on subsequent moves", async () => {
      await initBoard(testDir, "test", "Test");
      const ticket = await createTicket(testDir, { title: "Feature" });
      const inProgress = await moveTicket(testDir, ticket.id, "in-progress");
      const originalLocation = inProgress.codeLocation;

      const review = await moveTicket(testDir, ticket.id, "review");

      expect(review.codeLocation).toEqual(originalLocation);
    });
  });

  describe("addComment", () => {
    it("adds a comment to a ticket", async () => {
      await initBoard(testDir, "test", "Test");
      const ticket = await createTicket(testDir, { title: "Test" });

      const updated = await addComment(testDir, ticket.id, "agent", "Started working on this");

      expect(updated.comments).toHaveLength(1);
      expect(updated.comments![0].author).toBe("agent");
      expect(updated.comments![0].text).toBe("Started working on this");
      expect(updated.comments![0].createdAt).toBeDefined();
    });

    it("appends to existing comments", async () => {
      await initBoard(testDir, "test", "Test");
      const ticket = await createTicket(testDir, { title: "Test" });
      await addComment(testDir, ticket.id, "agent", "First note");

      const updated = await addComment(testDir, ticket.id, "human", "Second note");

      expect(updated.comments).toHaveLength(2);
      expect(updated.comments![0].text).toBe("First note");
      expect(updated.comments![1].text).toBe("Second note");
    });

    it("throws for non-existent ticket", async () => {
      await initBoard(testDir, "test", "Test");
      await expect(
        addComment(testDir, "FAKE-999", "agent", "Hello"),
      ).rejects.toThrow("Ticket not found");
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
    it("filters by status and sorts by creation date", async () => {
      await initBoard(testDir, "test", "Test");
      await createTicket(testDir, { title: "First" });
      await createTicket(testDir, { title: "Second" });
      await createTicket(testDir, { title: "Third" });

      const tickets = await getTicketsByStatus(testDir, "backlog");

      expect(tickets.length).toBe(3);
      expect(tickets[0].title).toBe("First");
      expect(tickets[2].title).toBe("Third");
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
    it("returns first ready item", async () => {
      await initBoard(testDir, "test", "Test");
      const first = await createTicket(testDir, { title: "First" });
      const second = await createTicket(testDir, { title: "Second" });
      await moveTicket(testDir, first.id, "ready");
      await moveTicket(testDir, second.id, "ready");

      const next = await getNextWorkItem(testDir);

      expect(next?.id).toBe(first.id);
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
});
