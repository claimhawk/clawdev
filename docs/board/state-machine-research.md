# Board State Machine: Research Document

**Status: COMPLETE**
**Ticket: Board State Machine**
**Branch: feat/board-state-machine**

---

## Problem Statement

Today, board tickets have statuses (`backlog`, `ready`, `in-progress`, `review`, `done`) and `moveTicket()` will place them anywhere with only WIP-limit enforcement. There is no automated processing: a ticket in Backlog sits idle until a human or agent explicitly moves it.

We want a state machine where each status transition triggers concrete work:

| Transition | Trigger | Automated Work |
|---|---|---|
| `backlog` (new ticket) | Ticket created | **Research phase**: gather context, explore codebase, produce a research artifact |
| Research artifact marked complete | System detects artifact completion | Move to `ready` |
| `ready` -> `in-progress` | Agent picks up (or human assigns) | **Planning phase**: produce implementation plan from research |
| Plan approved | Human review or auto-approve | Begin implementation |
| `in-progress` -> `review` | Agent signals completion | Await human review |
| `review` -> `done` | Human accepts | Archive, record metrics |

The key insight from [12-factor-agents](https://github.com/humanlayer/12-factor-agents) is that each status is not just a label but a **phase of execution** with its own prompt, context, and control flow.

---

## 12-Factor-Agents: Applicable Patterns

### Factor 2: Own Your Prompts

Each phase of the board state machine needs its own dedicated prompt, not a generic "do the next thing" instruction. The prompts are first-class code.

**Research phase prompt** (Backlog processing):
```
You are a senior engineer performing discovery on a new work item.

## Ticket
- Title: {ticket.title}
- Intent: {ticket.intent}
- Type: {ticket.type}

## Your Task
Produce a research document that covers:
1. **Relevant code**: Which files, modules, and functions are involved?
2. **Current behavior**: What does the system do today in this area?
3. **Dependencies**: What other systems or modules would be affected?
4. **Edge cases**: What could go wrong? What are the tricky parts?
5. **Prior art**: Are there existing patterns in the codebase to follow?

Do NOT propose solutions yet. Focus on understanding the problem space.
Output a structured markdown document.
```

**Planning phase prompt** (Ready -> In Progress):
```
You are a senior engineer creating an implementation plan.

## Ticket
- Title: {ticket.title}
- Intent: {ticket.intent}
- Research: {ticket.researchArtifact}

## Your Task
Using the research document, produce a concrete implementation plan:
1. **Approach**: Which strategy to use and why
2. **Files to modify**: Specific file paths and what changes in each
3. **New files**: Any new files needed, with purpose
4. **Data model changes**: Type/schema changes
5. **Test plan**: What to test, edge cases to cover
6. **Verification steps**: How to confirm the feature works
7. **Risks**: What might go wrong during implementation

The plan should be specific enough that another engineer (or agent)
could implement it without further clarification.
```

### Factor 5: Unify Execution State and Business State

Rather than tracking board execution state (current phase, pending research, waiting for approval) separately from the ticket itself, **unify them into the ticket**.

Current ticket fields cover business state. We extend with execution state:

```typescript
type Ticket = {
  // ... existing fields ...

  // Execution state (unified with business state)
  artifacts?: TicketArtifact[];        // Research docs, plans, etc.
  currentPhase?: TicketPhase;          // "research" | "planning" | "implementing" | "reviewing"
  phaseStartedAt?: string;             // When the current phase began
  phaseAttempts?: number;              // Retry count for current phase
};

type TicketArtifact = {
  kind: "research" | "plan" | "implementation-log";
  status: "in-progress" | "complete" | "rejected";
  path: string;                        // Relative path to artifact file
  createdAt: string;
  completedAt?: string;
  summary?: string;                    // Brief description of contents
};

type TicketPhase = "research" | "planning" | "implementing" | "reviewing";
```

The ticket itself is the single source of truth. No separate execution tables, no workflow engine state. Load the ticket, read its phase, and you know exactly what to do next.

### Factor 6: Launch/Pause/Resume

The board state machine must support interruption at any point:

- **Research in progress**: Agent is exploring the codebase. If interrupted, the partial research artifact persists. On resume, the agent reads the partial artifact and continues.
- **Waiting for human**: After research is complete, the ticket may wait for a human to review before moving to planning. This is a natural pause point.
- **Planning in progress**: Agent is drafting a plan. Same pause/resume as research.

Implementation: each phase writes its output to a file artifact (`docs/board/tickets/{ID}/research.md`, `docs/board/tickets/{ID}/plan.md`). Progress is durable because it lives on disk, not in memory.

```
board/
  tickets/
    PROJ-001/
      research.md      <- Research artifact
      plan.md          <- Implementation plan
      execution.log    <- Agent's work log
```

### Factor 8: Own Your Control Flow

The state machine loop for processing a Backlog ticket:

```typescript
async function processTicket(ticket: Ticket): Promise<void> {
  while (true) {
    const phase = determinePhase(ticket);

    switch (phase) {
      case "research": {
        // Backlog -> gather research
        const result = await runResearchAgent(ticket);
        if (result.status === "complete") {
          ticket.artifacts.push(result.artifact);
          // Research done -> move to ready
          await moveTicket(ticket.id, "ready");
          continue;
        }
        if (result.status === "needs-human") {
          // Pause: agent needs clarification
          await addComment(ticket.id, result.question);
          break; // exit loop, wait for human response
        }
        break;
      }

      case "planning": {
        // Ready -> In Progress: produce plan
        const result = await runPlanningAgent(ticket);
        if (result.status === "complete") {
          ticket.artifacts.push(result.artifact);
          continue; // move to implementing
        }
        break;
      }

      case "implementing": {
        // Agent does the work in the worktree
        const result = await runImplementationAgent(ticket);
        if (result.status === "complete") {
          await moveTicket(ticket.id, "review");
          break; // wait for human review
        }
        break;
      }

      case "reviewing":
        // Human-gated: exit the loop
        break;

      case "done":
        return;
    }

    // If we didn't continue, we're paused
    break;
  }
}
```

Key control flow decisions:
- **Research -> Ready**: automatic when artifact is marked complete
- **Ready -> In Progress**: can be human-triggered or auto-triggered
- **In Progress -> Review**: automatic when agent signals done
- **Review -> Done**: always human-gated

### Factor 10: Small, Focused Agents

Each phase uses a **separate, focused agent** rather than one monolithic agent:

| Phase | Agent | Scope | Max Steps |
|---|---|---|---|
| Research | `research-agent` | Read-only codebase exploration, produce research doc | ~10-15 |
| Planning | `planning-agent` | Read research + codebase, produce implementation plan | ~10-15 |
| Implementation | `impl-agent` | Write code following the plan in a worktree | ~20-30 |
| Review prep | `review-agent` | Summarize changes, run tests, prep PR description | ~5-10 |

Each agent has a small, well-defined context window. The research doc and plan serve as **compressed context** passed between agents, avoiding the need for one agent to hold everything.

### Factor 12: Stateless Reducer

The ticket processing function should be a pure reducer:

```
nextState = processTicketStep(currentTicket, event)
```

Where `event` might be:
- `{ type: "created" }` - new ticket in backlog
- `{ type: "research-complete", artifactPath: "..." }`
- `{ type: "human-approved" }`
- `{ type: "plan-complete", artifactPath: "..." }`
- `{ type: "implementation-complete" }`
- `{ type: "review-accepted" }`
- `{ type: "review-rejected", feedback: "..." }`

The reducer reads the ticket, applies the event, and returns the next ticket state. No hidden state, no side effects in the reducer itself. Side effects (running agents, moving files) happen in the orchestrator that calls the reducer.

---

## Proposed Status Transitions (State Machine)

```
                  +------------------+
                  |     BACKLOG      |
                  |  (auto-process)  |
                  +--------+---------+
                           |
                    research agent runs
                    produces research.md
                           |
                  +--------v---------+
                  |      READY       |
                  |  (has research)  |
                  +--------+---------+
                           |
                    agent picks up OR
                    human assigns
                    planning agent runs
                    produces plan.md
                           |
                  +--------v---------+
                  |   IN-PROGRESS    |
                  | (has plan, impl) |
                  +--------+---------+
                           |
                    impl agent works
                    in git worktree
                    signals completion
                           |
                  +--------v---------+
                  |      REVIEW      |
                  | (human-gated)    |
                  +--------+---------+
                           |
                    human accepts
                           |
                  +--------v---------+
                  |       DONE       |
                  +------------------+
```

---

## Implementation Scope

### Phase 1: Ticket Artifacts + Research Phase
- Extend `Ticket` type with `artifacts` and `currentPhase` fields
- Add artifact storage (`tickets/{ID}/research.md`)
- Implement `processBacklogTicket()` that runs the research agent
- Auto-move to `ready` when research artifact is marked complete
- Hook into board creation: new ticket -> schedule research processing

### Phase 2: Planning Phase
- Implement `processPlanningPhase()` that reads research, runs planning agent
- Planning agent produces `plan.md` artifact
- Auto-transition within `in-progress` from planning to implementing

### Phase 3: Implementation Agent Integration
- Implementation agent reads plan, works in the ticket's worktree
- Agent uses `codeLocation.branch` and `codeLocation.worktree`
- Auto-move to `review` when agent signals completion

### Phase 4: Review + Feedback Loop
- Human review UI in the board
- Rejection sends ticket back to `in-progress` with feedback as context
- Acceptance moves to `done`, records metrics

---

## Open Questions

1. **Research trigger**: Should research auto-start on ticket creation, or require an explicit "process backlog" action?
2. **Artifact format**: Plain markdown vs structured YAML frontmatter + markdown body?
3. **Human checkpoints**: Should the research -> ready transition require human approval, or be fully automated?
4. **Cron integration**: Should a cron job periodically scan backlog for unprocessed tickets?
5. **Error handling**: What happens if the research agent fails mid-run? Retry? Human fallback?

---

## References

- [12-Factor Agents](https://github.com/humanlayer/12-factor-agents) - HumanLayer
  - Factor 2: Own Your Prompts
  - Factor 5: Unify Execution State and Business State
  - Factor 6: Launch/Pause/Resume with Simple APIs
  - Factor 8: Own Your Control Flow
  - Factor 10: Small, Focused Agents
  - Factor 12: Make Your Agent a Stateless Reducer
- Current board implementation: `src/board/types.ts`, `src/board/storage.ts`
- Board tool: `src/agents/tools/board-tool.ts`
- Board gateway RPC: `src/gateway/server-methods/board.ts`
