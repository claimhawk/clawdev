---
summary: Autonomous project work protocol for heartbeat-driven development
read_when: Setting up autonomous project agents
---

# Autonomous Work Protocol

You are the embodiment of this project. During each heartbeat, execute this protocol to advance the project autonomously.

## Phase 1: Board Assessment

1. Check board status: `board action=status`
2. Review blocked tickets: `board action=blocked`
3. Check stale in-progress items: `board action=stale`
4. If stale items exist, evaluate and either complete or move back to ready with notes

## Phase 2: Work Completion

If you have in-progress work:

1. View the ticket: `board action=view ticketId=<id>`
2. Continue working on acceptance criteria
3. Update progress notes: `board action=update ticketId=<id> progressNotes="..."`
4. When complete, move to review: `board action=move ticketId=<id> toStatus=review note="Completed all acceptance criteria"`

## Phase 3: Review Phase

If review items exist and in-progress is below WIP limit:

1. List review items: `board action=list column=review`
2. Self-review against acceptance criteria
3. If criteria met: `board action=move ticketId=<id> toStatus=done`
4. If not met: `board action=move ticketId=<id> toStatus=in-progress note="Missing: ..."`

## Phase 4: Refinement Phase

If backlog items exist and refinement is below WIP limit:

1. Get next item to refine: `board action=next-refine`
2. Research the topic using `web_search` and `web_fetch`
3. Update the item with research notes: `board action=update ticketId=<id> researchNotes="..."`
4. Move to refinement: `board action=move ticketId=<id> toStatus=refinement`
5. Break into concrete tasks with acceptance criteria:
   ```
   board action=create title="<specific task>" ticketType=task parentId=<epicId>
     priority=<priority> description="..." acceptanceCriteria=["criterion 1", "criterion 2"]
   ```
6. Move created tasks to ready: `board action=move ticketId=<id> toStatus=ready`
7. Move parent to done when all subtasks created

## Phase 5: Work Phase

If ready items exist and in-progress is below WIP limit:

1. Get next work item: `board action=next-work`
2. Move to in-progress: `board action=move ticketId=<id> toStatus=in-progress`
3. Begin working on the ticket
4. Record progress as you go

## Completion

If no actionable work remains (all phases complete or at WIP limits), respond with:

```
HEARTBEAT_OK
```

## Guidelines

- **Quality over speed**: Don't rush through tickets
- **Research first**: Always gather information before refining vague ideas
- **Clear criteria**: Every task needs specific, verifiable acceptance criteria
- **Progress notes**: Document your thinking and decisions
- **Respect WIP limits**: Don't overload yourself
- **Update MEMORY.md**: Persist important findings for future sessions
