import { html, nothing } from "lit";

export type BoardTicket = {
  id: string;
  title: string;
  type: "feature" | "bugfix" | "chore" | "experiment";
  status: string;
  intent?: string;
  commentCount?: number;
  codeLocation?: { branch: string; worktree: string };
};

export type BoardColumn = {
  id: string;
  name: string;
  wipLimit: number | null;
  tickets: BoardTicket[];
};

export type BoardData = {
  projectId: string;
  projectName: string;
  columns: BoardColumn[];
  totalTickets: number;
  staleCount: number;
};

export type BoardProps = {
  loading: boolean;
  connected: boolean;
  board: BoardData | null;
  error: string | null;
  sessionKey: string;
  onRefresh: () => void;
  onMoveTicket: (ticketId: string, toStatus: string) => void;
  onCreateTicket: (title: string, type: string, intent?: string) => void;
  onViewTicket: (ticketId: string) => void;
};

const TYPE_COLORS: Record<string, string> = {
  feature: "#60a5fa",
  bugfix: "#ef4444",
  chore: "#14b8a6",
  experiment: "#f59e0b",
};

const TYPE_BG: Record<string, string> = {
  feature: "rgba(96, 165, 250, 0.18)",
  bugfix: "rgba(239, 68, 68, 0.18)",
  chore: "rgba(20, 184, 166, 0.18)",
  experiment: "rgba(245, 158, 11, 0.18)",
};

const COLUMN_COLORS: Record<string, string> = {
  backlog: "#71717a",
  ready: "#3b82f6",
  "in-progress": "#f59e0b",
  review: "#a78bfa",
  done: "#22c55e",
};

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/* ── Modal state (module-level so it persists across re-renders) ── */
let _modalOpen = false;
let _modalTitle = "";
let _modalIntent = "";
let _modalType = "feature";
let _modalHost: { requestUpdate?: () => void } | null = null;

function openModal(host: { requestUpdate?: () => void }) {
  _modalOpen = true;
  _modalTitle = "";
  _modalIntent = "";
  _modalType = "feature";
  _modalHost = host;
  host.requestUpdate?.();
  requestAnimationFrame(() => {
    const input = document.querySelector(".bk-modal__title-input") as HTMLInputElement | null;
    input?.focus();
  });
}

function closeModal() {
  _modalOpen = false;
  _modalHost?.requestUpdate?.();
  _modalHost = null;
}

function renderModal(onCreateTicket: (title: string, type: string, intent?: string) => void) {
  if (!_modalOpen) return nothing;

  const handleSubmit = () => {
    const title = _modalTitle.trim();
    if (!title) return;
    const intent = _modalIntent.trim() || undefined;
    onCreateTicket(title, _modalType, intent);
    closeModal();
  };

  const handleKeydown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      closeModal();
    }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      handleSubmit();
    }
  };

  const handleBackdropClick = (e: Event) => {
    if ((e.target as HTMLElement).classList.contains("bk-modal__backdrop")) {
      closeModal();
    }
  };

  return html`
    <div class="bk-modal__backdrop" @click=${handleBackdropClick} @keydown=${handleKeydown}>
      <div class="bk-modal">
        <div class="bk-modal__header">
          <h3 class="bk-modal__heading">New Story</h3>
          <button class="bk-modal__close" @click=${closeModal}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <div class="bk-modal__body">
          <label class="bk-modal__label">Title</label>
          <input
            class="bk-modal__title-input"
            type="text"
            placeholder="What needs to happen?"
            .value=${_modalTitle}
            @input=${(e: Event) => { _modalTitle = (e.target as HTMLInputElement).value; }}
            @keydown=${(e: KeyboardEvent) => {
              if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
                e.preventDefault();
                const desc = document.querySelector(".bk-modal__desc-input") as HTMLTextAreaElement | null;
                desc?.focus();
              }
            }}
          />

          <label class="bk-modal__label">Intent <span class="bk-modal__optional">optional</span></label>
          <textarea
            class="bk-modal__desc-input"
            placeholder="What should the agent accomplish? What does success look like?"
            rows="10"
            .value=${_modalIntent}
            @input=${(e: Event) => { _modalIntent = (e.target as HTMLTextAreaElement).value; }}
          ></textarea>

          <label class="bk-modal__label">Type</label>
          <select
            class="bk-modal__select"
            .value=${_modalType}
            @change=${(e: Event) => { _modalType = (e.target as HTMLSelectElement).value; _modalHost?.requestUpdate?.(); }}
          >
            <option value="feature">Feature</option>
            <option value="bugfix">Bugfix</option>
            <option value="chore">Chore</option>
            <option value="experiment">Experiment</option>
          </select>
        </div>

        <div class="bk-modal__footer">
          <button class="bk-modal__btn-cancel" @click=${closeModal}>Cancel</button>
          <button
            class="bk-modal__btn-submit"
            ?disabled=${!_modalTitle.trim()}
            @click=${handleSubmit}
          >
            Add to Backlog
          </button>
        </div>
      </div>
    </div>
  `;
}

function renderTicketCard(
  ticket: BoardTicket,
  onView: (id: string) => void,
  onDragStart: (e: DragEvent, id: string) => void,
) {
  const typeColor = TYPE_COLORS[ticket.type] || "#71717a";
  const typeBg = TYPE_BG[ticket.type] || "rgba(113, 113, 122, 0.18)";
  const commentCount = ticket.commentCount ?? 0;

  return html`
    <div
      class="bk-card"
      draggable="true"
      @dragstart=${(e: DragEvent) => onDragStart(e, ticket.id)}
      @click=${() => onView(ticket.id)}
    >
      <div class="bk-card__top">
        <div class="bk-card__tags">
          <span class="bk-pill" style="color: ${typeColor}; background: ${typeBg}">
            ${capitalize(ticket.type)}
          </span>
        </div>
        <button class="bk-card__menu" @click=${(e: Event) => { e.stopPropagation(); }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>
        </button>
      </div>
      <div class="bk-card__title">${ticket.title}</div>
      <div class="bk-card__footer">
        <span class="bk-card__id">${ticket.id}</span>
        ${commentCount > 0
          ? html`<span class="bk-card__comments" title="${commentCount} comment${commentCount > 1 ? "s" : ""}">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
              ${commentCount}
            </span>`
          : nothing}
      </div>
    </div>
  `;
}

function renderColumn(
  column: BoardColumn,
  onMoveTicket: (ticketId: string, toStatus: string) => void,
  onViewTicket: (ticketId: string) => void,
) {
  const count = column.tickets.length;
  const atLimit = column.wipLimit !== null && count >= column.wipLimit;
  const dotColor = COLUMN_COLORS[column.id] || "#71717a";

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).classList.add("bk-col--drag-over");
  };

  const handleDragLeave = (e: DragEvent) => {
    (e.currentTarget as HTMLElement).classList.remove("bk-col--drag-over");
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).classList.remove("bk-col--drag-over");
    const ticketId = e.dataTransfer?.getData("text/plain");
    if (ticketId) {
      onMoveTicket(ticketId, column.id);
    }
  };

  const handleDragStart = (e: DragEvent, ticketId: string) => {
    e.dataTransfer?.setData("text/plain", ticketId);
  };

  return html`
    <div
      class="bk-col"
      @dragover=${handleDragOver}
      @dragleave=${handleDragLeave}
      @drop=${handleDrop}
    >
      <div class="bk-col__header">
        <div class="bk-col__left">
          <span class="bk-col__pill" style="--col-dot: ${dotColor}">
            ${column.name.toUpperCase()}
          </span>
          <span class="bk-col__count ${atLimit ? "bk-col__count--warn" : ""}">${count}</span>
        </div>
        <div class="bk-col__actions">
          <button class="bk-col__btn" title="Column options">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg>
          </button>
        </div>
      </div>
      <div class="bk-col__body">
        ${column.tickets.map((ticket) =>
          renderTicketCard(ticket, onViewTicket, handleDragStart),
        )}
      </div>
    </div>
  `;
}

export function renderBoard(props: BoardProps) {
  if (!props.connected) {
    return html`
      <section class="card">
        <div class="card-title">Board</div>
        <div class="card-sub">Connect to the gateway to view the project board.</div>
      </section>
    `;
  }

  if (props.loading) {
    return html`
      <div class="bk-loading">
        <div class="bk-loading__spinner"></div>
        <span>Loading board...</span>
      </div>
    `;
  }

  if (props.error) {
    return html`
      <section class="card">
        <div class="card-title">Board</div>
        <div class="error-box">${props.error}</div>
        <button class="btn" @click=${props.onRefresh}>Retry</button>
      </section>
    `;
  }

  if (!props.board) {
    return html`
      <section class="card">
        <div class="row" style="justify-content: space-between; align-items: center;">
          <div>
            <div class="card-title">Board</div>
            <div class="card-sub">No board found for this agent session.</div>
          </div>
          <button class="btn" @click=${props.onRefresh}>Refresh</button>
        </div>
      </section>
    `;
  }

  // We need a host reference for modal re-renders.
  // The board is rendered inside a Lit element, so we walk up from the event to find it.
  const getHost = (): { requestUpdate?: () => void } => {
    const el = document.querySelector("openclaw-app");
    return (el as unknown as { requestUpdate?: () => void }) ?? {};
  };

  const handleOpenModal = () => openModal(getHost());

  return html`
    <style>
      /* ── Board Root ──────────────────────────────── */
      .bk-root {
        display: flex;
        flex-direction: column;
        height: 100%;
      }
      .bk-toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 0 16px;
        flex-shrink: 0;
      }
      .bk-toolbar__left {
        display: flex;
        align-items: center;
        gap: 14px;
      }
      .bk-toolbar__title {
        font-size: 20px;
        font-weight: 700;
        color: var(--text-strong);
        font-family: var(--font-display);
      }
      .bk-toolbar__stats {
        display: flex;
        align-items: center;
        gap: 14px;
        font-size: 12px;
        color: var(--muted);
      }
      .bk-toolbar__stat {
        display: flex;
        align-items: center;
        gap: 4px;
      }
      .bk-toolbar__stat-val {
        font-weight: 600;
        color: var(--text);
      }
      .bk-toolbar__stat--warn .bk-toolbar__stat-val { color: var(--warn); }
      .bk-toolbar__right {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .bk-btn-refresh {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 7px 14px;
        font-size: 12px;
        font-weight: 500;
        font-family: var(--font-body);
        color: var(--text);
        background: var(--bg-elevated);
        border: 1px solid var(--border);
        border-radius: var(--radius-md);
        cursor: pointer;
        transition: background var(--duration-fast) var(--ease-out),
                    border-color var(--duration-fast) var(--ease-out);
      }
      .bk-btn-refresh:hover {
        background: var(--bg-hover);
        border-color: var(--border-strong);
      }
      .bk-btn-add {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 7px 14px;
        font-size: 12px;
        font-weight: 600;
        font-family: var(--font-body);
        color: var(--accent-foreground);
        background: var(--accent);
        border: none;
        border-radius: var(--radius-md);
        cursor: pointer;
        transition: background var(--duration-fast) var(--ease-out),
                    opacity var(--duration-fast) var(--ease-out);
      }
      .bk-btn-add:hover {
        background: var(--accent-hover);
      }

      /* ── Board Columns Container ─────────────────── */
      .bk-board {
        display: flex;
        gap: 14px;
        flex: 1;
        overflow-x: auto;
        overflow-y: hidden;
        padding-bottom: 8px;
      }

      /* ── Column ──────────────────────────────────── */
      .bk-col {
        flex: 1;
        min-width: 240px;
        max-width: 340px;
        display: flex;
        flex-direction: column;
        border-radius: var(--radius-lg);
        transition: border-color var(--duration-fast) var(--ease-out);
      }
      .bk-col--drag-over {
        background: var(--bg-elevated);
        outline: 2px solid var(--accent);
        outline-offset: -2px;
        border-radius: var(--radius-lg);
      }
      .bk-col__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0 2px 12px;
      }
      .bk-col__left {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .bk-col__pill {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 5px 12px;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.04em;
        color: var(--text-strong);
        background: var(--bg-elevated);
        border: 1px solid var(--border);
        border-radius: var(--radius-sm);
        line-height: 1;
        white-space: nowrap;
      }
      .bk-col__pill::before {
        content: "";
        display: inline-block;
        width: 8px;
        height: 8px;
        border-radius: var(--radius-full);
        background: var(--col-dot, #71717a);
        flex-shrink: 0;
      }
      .bk-col__count {
        font-size: 11px;
        font-weight: 700;
        color: var(--text);
        background: var(--bg-hover);
        padding: 3px 8px;
        border-radius: var(--radius-sm);
        min-width: 18px;
        text-align: center;
        line-height: 1;
      }
      .bk-col__count--warn {
        color: var(--warn);
        background: var(--warn-subtle);
      }
      .bk-col__actions {
        display: flex;
        align-items: center;
        gap: 2px;
      }
      .bk-col__btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        border: none;
        background: transparent;
        color: var(--muted);
        border-radius: var(--radius-sm);
        cursor: pointer;
        transition: color var(--duration-fast), background var(--duration-fast);
      }
      .bk-col__btn:hover {
        color: var(--text);
        background: var(--bg-hover);
      }
      .bk-col__body {
        flex: 1;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding: 0 2px 2px;
      }
      /* ── Ticket Card ─────────────────────────────── */
      .bk-card {
        background: var(--bg-elevated);
        border: 1px solid var(--border);
        border-radius: var(--radius-lg);
        padding: 14px 14px 12px;
        cursor: grab;
        user-select: none;
        transition: transform var(--duration-fast) var(--ease-out),
                    box-shadow var(--duration-normal) var(--ease-out),
                    border-color var(--duration-fast) var(--ease-out);
        position: relative;
      }
      .bk-card:hover {
        transform: translateY(-2px);
        box-shadow: var(--shadow-lg);
        border-color: var(--border-strong);
      }
      .bk-card:active {
        cursor: grabbing;
        transform: scale(0.98);
        box-shadow: var(--shadow-sm);
      }
      .bk-card__top {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 6px;
        margin-bottom: 10px;
      }
      .bk-card__tags {
        display: flex;
        flex-wrap: wrap;
        gap: 5px;
      }
      .bk-card__menu {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 22px;
        height: 22px;
        border: none;
        background: transparent;
        color: var(--muted);
        border-radius: var(--radius-sm);
        cursor: pointer;
        flex-shrink: 0;
        opacity: 0;
        transition: opacity var(--duration-fast), color var(--duration-fast),
                    background var(--duration-fast);
      }
      .bk-card:hover .bk-card__menu { opacity: 1; }
      .bk-card__menu:hover {
        color: var(--text);
        background: var(--bg-hover);
      }
      .bk-pill {
        display: inline-flex;
        align-items: center;
        gap: 3px;
        padding: 3px 8px;
        font-size: 11px;
        font-weight: 600;
        border-radius: var(--radius-sm);
        line-height: 1;
        white-space: nowrap;
      }
      .bk-card__title {
        font-size: 13px;
        font-weight: 500;
        line-height: 1.5;
        color: var(--text);
        word-break: break-word;
        display: -webkit-box;
        -webkit-line-clamp: 3;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }
      .bk-card__footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-top: 12px;
        gap: 8px;
      }
      .bk-card__id {
        font-size: 10px;
        font-family: var(--mono);
        color: var(--muted);
      }
      .bk-card__comments {
        display: inline-flex;
        align-items: center;
        gap: 3px;
        font-size: 10px;
        color: var(--muted);
        font-family: var(--mono);
      }

      /* ── Modal ───────────────────────────────────── */
      .bk-modal__backdrop {
        position: fixed;
        inset: 0;
        z-index: 1000;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(0, 0, 0, 0.7);
        backdrop-filter: blur(12px);
        animation: bk-fade-in 0.15s var(--ease-out);
      }
      @keyframes bk-fade-in {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      .bk-modal {
        width: 760px;
        max-width: calc(100vw - 48px);
        max-height: calc(100vh - 80px);
        background: var(--bg-elevated);
        border: 1px solid var(--border-strong);
        border-radius: var(--radius-xl);
        box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        animation: bk-modal-in 0.2s var(--ease-spring);
      }
      @keyframes bk-modal-in {
        from { opacity: 0; transform: scale(0.95) translateY(8px); }
        to { opacity: 1; transform: scale(1) translateY(0); }
      }
      .bk-modal__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 32px 40px 0;
      }
      .bk-modal__heading {
        font-size: 22px;
        font-weight: 700;
        color: var(--text-strong);
        font-family: var(--font-display);
        margin: 0;
      }
      .bk-modal__close {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 32px;
        height: 32px;
        border: none;
        background: transparent;
        color: var(--muted);
        border-radius: var(--radius-sm);
        cursor: pointer;
        transition: color var(--duration-fast), background var(--duration-fast);
      }
      .bk-modal__close:hover {
        color: var(--text);
        background: var(--bg-hover);
      }
      .bk-modal__body {
        padding: 32px 40px;
        display: flex;
        flex-direction: column;
        gap: 6px;
        overflow-y: auto;
      }
      .bk-modal__label {
        font-size: 14px;
        font-weight: 600;
        color: var(--text);
        margin-bottom: 8px;
        margin-top: 16px;
      }
      .bk-modal__label:first-child {
        margin-top: 0;
      }
      .bk-modal__optional {
        font-weight: 400;
        color: var(--muted);
        margin-left: 4px;
      }
      .bk-modal__title-input {
        width: 100%;
        padding: 18px 20px;
        font-size: 17px;
        font-family: var(--font-body);
        color: var(--text);
        background: var(--bg);
        border: 1px solid var(--border);
        border-radius: var(--radius-md);
        outline: none;
        transition: border-color var(--duration-fast), box-shadow var(--duration-fast);
        box-sizing: border-box;
      }
      .bk-modal__title-input:focus {
        border-color: var(--accent);
        box-shadow: 0 0 0 3px var(--accent-subtle);
      }
      .bk-modal__title-input::placeholder {
        color: var(--muted);
      }
      .bk-modal__desc-input {
        width: 100%;
        padding: 18px 20px;
        font-size: 15px;
        font-family: var(--font-body);
        color: var(--text);
        background: var(--bg);
        border: 1px solid var(--border);
        border-radius: var(--radius-md);
        outline: none;
        resize: vertical;
        min-height: 220px;
        line-height: 1.5;
        transition: border-color var(--duration-fast), box-shadow var(--duration-fast);
        box-sizing: border-box;
      }
      .bk-modal__desc-input:focus {
        border-color: var(--accent);
        box-shadow: 0 0 0 3px var(--accent-subtle);
      }
      .bk-modal__desc-input::placeholder {
        color: var(--muted);
      }
      .bk-modal__select {
        width: 100%;
        padding: 16px 20px;
        font-size: 15px;
        font-family: var(--font-body);
        color: var(--text);
        background: var(--bg);
        border: 1px solid var(--border);
        border-radius: var(--radius-md);
        outline: none;
        cursor: pointer;
        appearance: none;
        background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2371717a' stroke-width='2' stroke-linecap='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");
        background-repeat: no-repeat;
        background-position: right 16px center;
        transition: border-color var(--duration-fast), box-shadow var(--duration-fast);
        box-sizing: border-box;
      }
      .bk-modal__select:focus {
        border-color: var(--accent);
        box-shadow: 0 0 0 3px var(--accent-subtle);
      }
      .bk-modal__select option {
        background: var(--bg-elevated);
        color: var(--text);
        padding: 8px;
      }
      .bk-modal__footer {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 10px;
        padding: 28px 40px 32px;
        border-top: 1px solid var(--border);
      }
      .bk-modal__btn-cancel {
        padding: 12px 24px;
        font-size: 14px;
        font-weight: 500;
        font-family: var(--font-body);
        color: var(--muted);
        background: transparent;
        border: 1px solid var(--border);
        border-radius: var(--radius-md);
        cursor: pointer;
        transition: color var(--duration-fast), border-color var(--duration-fast),
                    background var(--duration-fast);
      }
      .bk-modal__btn-cancel:hover {
        color: var(--text);
        border-color: var(--border-strong);
        background: var(--bg-hover);
      }
      .bk-modal__btn-submit {
        padding: 12px 28px;
        font-size: 14px;
        font-weight: 600;
        font-family: var(--font-body);
        color: var(--accent-foreground);
        background: var(--accent);
        border: none;
        border-radius: var(--radius-md);
        cursor: pointer;
        transition: background var(--duration-fast), opacity var(--duration-fast);
      }
      .bk-modal__btn-submit:hover {
        background: var(--accent-hover);
      }
      .bk-modal__btn-submit:disabled {
        opacity: 0.4;
        cursor: not-allowed;
      }

      /* ── Loading ─────────────────────────────────── */
      .bk-loading {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        padding: 64px 0;
        color: var(--muted);
        font-size: 13px;
      }
      .bk-loading__spinner {
        width: 18px;
        height: 18px;
        border: 2px solid var(--border);
        border-top-color: var(--accent);
        border-radius: 50%;
        animation: bk-spin 0.6s linear infinite;
      }
      @keyframes bk-spin {
        to { transform: rotate(360deg); }
      }
    </style>

    <div class="bk-root">
      <div class="bk-toolbar">
        <div class="bk-toolbar__left">
          <span class="bk-toolbar__title">${props.board.projectName}</span>
          <div class="bk-toolbar__stats">
            <span class="bk-toolbar__stat">
              <span class="bk-toolbar__stat-val">${props.board.totalTickets}</span> tickets
            </span>
            ${props.board.staleCount > 0
              ? html`<span class="bk-toolbar__stat bk-toolbar__stat--warn">
                  <span class="bk-toolbar__stat-val">${props.board.staleCount}</span> stale
                </span>`
              : nothing}
          </div>
        </div>
        <div class="bk-toolbar__right">
          <button class="bk-btn-add" @click=${handleOpenModal}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Add Story
          </button>
          <button class="bk-btn-refresh" @click=${props.onRefresh}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/>
              <path d="M21 3v5h-5"/>
            </svg>
            Refresh
          </button>
        </div>
      </div>

      <div class="bk-board">
        ${props.board.columns.map((column) =>
          renderColumn(column, props.onMoveTicket, props.onViewTicket),
        )}
      </div>
    </div>

    ${renderModal(props.onCreateTicket)}
  `;
}
