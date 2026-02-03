---
summary: Project board tool for autonomous agent work
read_when: Setting up project-driven autonomous agents
---

# Board Tool

The board tool provides Kanban-style project management for autonomous agent work. Agents can manage their own backlogs, refine vague ideas into concrete tasks, and work through tickets during heartbeat cycles.

## Overview

Each agent workspace can have a project board with:

- **Backlog**: Vague ideas and epics
- **Refinement**: Items being researched and broken down
- **Ready**: Concrete tasks with acceptance criteria
- **In Progress**: Currently being worked (WIP limited)
- **Review**: Completed, awaiting verification
- **Done**: Verified complete

## Quick Start

### Initialize a Board

```
board action=init projectId=security projectName="Security Hardening"
```

### Add a Vague Idea

```
board action=create title="Harden security against prompt injection" ticketType=epic priority=high
```

### Check Board Status

```
board action=status
```

### Autonomous Refinement

During heartbeat, the agent:

1. Gets next refinement item: `board action=next-refine`
2. Researches using `web_search`
3. Breaks into tasks with acceptance criteria
4. Moves refined tasks to ready

### Work Flow

```
board action=next-work                                    # Get next ready item
board action=move ticketId=SEC-001 toStatus=in-progress   # Start working
board action=update ticketId=SEC-001 progressNotes="..."  # Track progress
board action=move ticketId=SEC-001 toStatus=review        # Complete
board action=move ticketId=SEC-001 toStatus=done          # Verified
```

## Actions

| Action        | Description           | Required Params            |
| ------------- | --------------------- | -------------------------- |
| `init`        | Initialize board      | `projectId`, `projectName` |
| `status`      | Board overview        | -                          |
| `list`        | List tickets          | `column?`, `type?`         |
| `view`        | View ticket details   | `ticketId`                 |
| `create`      | Create ticket         | `title`                    |
| `update`      | Update ticket         | `ticketId`                 |
| `move`        | Move to column        | `ticketId`, `toStatus`     |
| `delete`      | Delete ticket         | `ticketId`                 |
| `next-work`   | Get next ready item   | -                          |
| `next-refine` | Get next backlog item | -                          |
| `stale`       | List stale items      | -                          |
| `blocked`     | List blocked items    | -                          |
| `children`    | List child tickets    | `ticketId`                 |

## Ticket Types

| Type       | Usage                    |
| ---------- | ------------------------ |
| `epic`     | Large, vague initiatives |
| `story`    | User-facing features     |
| `task`     | Concrete work items      |
| `bug`      | Defects to fix           |
| `research` | Investigation tasks      |

## Priorities

- `critical`: Drop everything
- `high`: Important, do soon
- `medium`: Normal priority (default)
- `low`: Nice to have

## WIP Limits

Default work-in-progress limits:

| Column      | Limit |
| ----------- | ----- |
| Refinement  | 3     |
| Ready       | 10    |
| In Progress | 2     |
| Review      | 5     |

The agent respects these limits to avoid context overload.

## Heartbeat Integration

Configure your agent for autonomous work:

```yaml
agents:
  list:
    - id: security-project
      workspace: ~/projects/security/.openclaw
      heartbeat:
        every: 30m
        activeHours:
          start: "22:00"
          end: "08:00"
```

Create `HEARTBEAT.md` in the workspace with the autonomous work protocol (see `PROJECT_HEARTBEAT.md` template).

## File Structure

Boards are stored in the agent workspace:

```
<workspace>/
  board/
    board.yaml       # Board configuration
    tickets/
      SEC-001.yaml   # Individual tickets
      SEC-002.yaml
      ...
```

## Configuration

Board settings in `board.yaml`:

```yaml
settings:
  autoRefine: true # Refine during heartbeat
  autoWork: true # Work during heartbeat
  requireReview: true # Require review before done
  staleInProgressHours: 24 # Hours before stale warning
  maxRefinePerHeartbeat: 1 # Refinements per heartbeat
  maxWorkPerHeartbeat: 1 # Work items per heartbeat
  ticketPrefix: SEC # Ticket ID prefix
```

## Example: Security Hardening Project

```
# Initialize
board action=init projectId=security projectName="Security Hardening"

# Add vague goals to backlog
board action=create title="Harden security against prompt injection" ticketType=epic priority=high
board action=create title="Improve input validation" ticketType=story priority=medium

# Agent refines during heartbeat:
# - Researches prompt injection techniques
# - Creates concrete tasks:

board action=create title="Audit user input entry points" ticketType=task priority=high \
  parentId=SEC-001 acceptanceCriteria=["Document all entry points", "Identify unvalidated inputs"]

board action=create title="Implement input sanitization for chat messages" ticketType=task \
  priority=high parentId=SEC-001 acceptanceCriteria=["Add sanitizer", "Add tests", "No regressions"]

# Work through tasks
board action=move ticketId=SEC-002 toStatus=in-progress
# ... agent works ...
board action=move ticketId=SEC-002 toStatus=review note="Implemented sanitization"
board action=move ticketId=SEC-002 toStatus=done
```

## Best Practices

1. **Start vague**: Add epics/stories to backlog, let the agent refine
2. **Clear acceptance criteria**: Every task needs specific, verifiable criteria
3. **Respect WIP limits**: Don't manually override; trust the system
4. **Research notes**: Capture findings during refinement
5. **Progress notes**: Document decisions during work
6. **Use MEMORY.md**: Persist important learnings across sessions
