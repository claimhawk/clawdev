import { html, nothing, render as litRender } from "lit";
import { repeat } from "lit/directives/repeat.js";
import type { AppViewState } from "./app-view-state";
import type { ThemeMode } from "./theme";
import type { ThemeTransitionContext } from "./theme-transition";
import type { AgentsListResult, SessionsListResult } from "./types";
import { parseAgentSessionKey } from "../../../src/routing/session-key.js";
import { refreshChat } from "./app-chat";
import { syncUrlWithSessionKey } from "./app-settings";
import { loadAgents } from "./controllers/agents";
import { loadChatHistory } from "./controllers/chat";
import { loadSessions } from "./controllers/sessions";
import { icons } from "./icons";
import { iconForTab, pathForTab, titleForTab, type Tab } from "./navigation";

/**
 * Renders the global session selector in the topbar.
 * Available on all pages to switch between agent sessions.
 */

function switchToSession(state: AppViewState, next: string) {
  state.sessionKey = next;
  state.chatMessage = "";
  state.chatStream = null;
  state.chatStreamStartedAt = null;
  state.chatRunId = null;
  state.resetToolStream();
  state.resetChatScroll();
  state.applySettings({
    ...state.settings,
    sessionKey: next,
    lastActiveSessionKey: next,
  });
  void state.loadAssistantIdentity();
  syncUrlWithSessionKey(state, next, true);
  void loadChatHistory(state);
  void state.handleLoadBoard?.();
  void loadSessions(state);
}

// --- Custom dropdown state (closure-level) ---
let _dropdownOpen = false;
let _confirmingKey: string | null = null;
let _creatingAgent = false;
let _dropdownContainer: HTMLElement | null = null;

function closeDropdown() {
  _dropdownOpen = false;
  _confirmingKey = null;
  _creatingAgent = false;
}

/** Returns true if this session key is protected from deletion. */
function isProtectedKey(key: string, mainSessionKey: string | null): boolean {
  if (key === "main") {
    return true;
  }
  if (mainSessionKey && key === mainSessionKey) {
    return true;
  }
  // agent:main:main is the default main agent session
  const parsed = parseAgentSessionKey(key);
  if (parsed?.agentId === "main") {
    return true;
  }
  return false;
}

/** Extracts the agent id from a session key like "agent:foo:main" → "foo". */
function agentIdFromKey(key: string): string | null {
  const parsed = parseAgentSessionKey(key);
  return parsed?.agentId ?? null;
}

type AgentEntry = { id: string; name?: string };

/**
 * Merge agent lists from local UI state and config.get into a single
 * deduplicated list.  Union by id ensures no agent is lost even when
 * one source is stale (e.g. gateway mid-restart).  Local state wins
 * for name when both sources have the same id.
 */
function mergeAgentLists(local: AgentEntry[], remote: AgentEntry[]): AgentEntry[] {
  const byId = new Map<string, AgentEntry>();
  // Remote first so local overwrites
  for (const a of remote) {
    byId.set(a.id, { id: a.id, name: a.name });
  }
  for (const a of local) {
    byId.set(a.id, { id: a.id, name: a.name });
  }
  return [...byId.values()];
}

function buildLocalAgentList(state: AppViewState): AgentEntry[] {
  if (!state.agentsList?.agents) {
    return [];
  }
  return state.agentsList.agents.map((a) => ({ id: a.id, name: a.name }));
}

function renderDropdownContent(state: AppViewState) {
  const mainSessionKey = resolveMainSessionKey(state.hello, state.sessionsResult);
  const sessionOptions = resolveSessionOptions(
    state.sessionKey,
    state.sessionsResult,
    mainSessionKey,
    state.agentsList,
  );

  const handleSelect = (key: string) => {
    closeDropdown();
    rerenderDropdown(state);
    switchToSession(state, key);
  };

  const handleTrashClick = (key: string, e: Event) => {
    e.stopPropagation();
    _confirmingKey = key;
    rerenderDropdown(state);
  };

  const handleConfirmDelete = async (key: string, e: Event) => {
    e.stopPropagation();
    const agentId = agentIdFromKey(key);
    if (!agentId) {
      return;
    }

    // Optimistically update local state so the UI reflects the change now
    if (state.agentsList) {
      state.agentsList = {
        ...state.agentsList,
        agents: state.agentsList.agents.filter((a) => a.id !== agentId),
      };
    }
    if (state.sessionsResult?.sessions) {
      const deletedPrefix = `agent:${agentId}:`;
      state.sessionsResult = {
        ...state.sessionsResult,
        sessions: state.sessionsResult.sessions.filter((s) => !s.key.startsWith(deletedPrefix)),
      };
    }

    if (state.sessionKey === key) {
      const fallback = mainSessionKey ?? "main";
      switchToSession(state, fallback);
    }

    closeDropdown();
    rerenderDropdown(state);

    try {
      // Fetch config for baseHash + remote agent list
      const snapshot = await state.client?.request<{
        config: { agents?: { list?: AgentEntry[] } };
        baseHash: string;
      }>("config.get", {});

      // Merge local + remote so no agent is lost from either source,
      // then remove the target agent from the merged result.
      const remoteAgents = snapshot?.config?.agents?.list ?? [];
      const localAgents = buildLocalAgentList(state);
      const merged = mergeAgentLists(localAgents, remoteAgents);
      const updatedList = merged.filter((a) => a.id !== agentId);

      await state.client?.request("config.patch", {
        raw: JSON.stringify({ agents: { list: updatedList } }),
        baseHash: snapshot?.baseHash,
      });

      try {
        await loadAgents(state);
      } catch {
        // Gateway may be restarting
      }
    } catch (err) {
      console.error("[session-selector] Failed to delete agent:", err);
    }
  };

  const handleShowCreateInput = (e: Event) => {
    e.stopPropagation();
    _creatingAgent = true;
    _confirmingKey = null;
    rerenderDropdown(state);
    requestAnimationFrame(() => {
      const input = _dropdownContainer?.querySelector<HTMLInputElement>(
        ".session-selector__create-input",
      );
      input?.focus();
    });
  };

  const submitNewAgent = async (projectName: string) => {
    const trimmed = projectName.trim();
    if (!trimmed) {
      return;
    }

    const agentId = trimmed
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    if (!agentId) {
      return;
    }

    // Check if already exists locally
    const localAgents = buildLocalAgentList(state);
    if (localAgents.some((a) => a.id === agentId)) {
      closeDropdown();
      rerenderDropdown(state);
      switchToSession(state, `agent:${agentId}:main`);
      return;
    }

    const newSessionKey = `agent:${agentId}:main`;
    const newEntry: AgentEntry = { id: agentId, name: trimmed };

    // Optimistically update local state
    if (state.agentsList) {
      state.agentsList = {
        ...state.agentsList,
        agents: [...state.agentsList.agents, { id: agentId, name: trimmed }],
      };
    }

    closeDropdown();
    rerenderDropdown(state);
    switchToSession(state, newSessionKey);

    try {
      // Fetch config for baseHash + remote agent list
      const snapshot = await state.client?.request<{
        config: { agents?: { list?: AgentEntry[] } };
        baseHash: string;
      }>("config.get", {});

      // Merge local + remote, then add the new agent.
      // mergeAgentLists dedupes by id, so the new agent (already in
      // local state) will be included even if config.get is stale.
      const remoteAgents = snapshot?.config?.agents?.list ?? [];
      const merged = mergeAgentLists(localAgents, remoteAgents);
      const updatedList = merged.some((a) => a.id === agentId) ? merged : [...merged, newEntry];

      await state.client?.request("config.patch", {
        raw: JSON.stringify({ agents: { list: updatedList } }),
        baseHash: snapshot?.baseHash,
      });

      try {
        await loadAgents(state);
      } catch {
        // Expected during gateway restart
      }
    } catch (err) {
      console.error("[session-selector] Failed to create agent:", err);
    }
  };

  const handleCreateKeydown = (e: KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "Enter") {
      const input = e.target as HTMLInputElement;
      void submitNewAgent(input.value);
    } else if (e.key === "Escape") {
      _creatingAgent = false;
      rerenderDropdown(state);
    }
  };

  const handleCreateSubmit = (e: Event) => {
    e.stopPropagation();
    const input = _dropdownContainer?.querySelector<HTMLInputElement>(
      ".session-selector__create-input",
    );
    if (input) {
      void submitNewAgent(input.value);
    }
  };

  return html`
    ${repeat(
      sessionOptions,
      (entry) => entry.key,
      (entry) => {
        const isActive = entry.key === state.sessionKey;
        const isDeletable = !isProtectedKey(entry.key, mainSessionKey);
        const isConfirming = _confirmingKey === entry.key;

        return html`
          <div
            class="session-selector__option ${isActive ? "session-selector__option--active" : ""}"
            @click=${() => handleSelect(entry.key)}
          >
            <span class="session-selector__option-label">
              ${entry.displayName ?? entry.key}
            </span>
            ${
              isDeletable
                ? isConfirming
                  ? html`<button
                    class="session-selector__confirm-btn"
                    @click=${(e: Event) => void handleConfirmDelete(entry.key, e)}
                    title="Confirm removal"
                  >Confirm</button>`
                  : html`<button
                    class="session-selector__delete-btn"
                    @click=${(e: Event) => handleTrashClick(entry.key, e)}
                    title="Remove agent"
                  >🗑</button>`
                : nothing
            }
          </div>
        `;
      },
    )}
    <div class="session-selector__divider"></div>
    ${
      _creatingAgent
        ? html`
        <div class="session-selector__create-row" @click=${(e: Event) => e.stopPropagation()}>
          <input
            class="session-selector__create-input"
            type="text"
            placeholder="Agent name"
            @keydown=${handleCreateKeydown}
            @click=${(e: Event) => e.stopPropagation()}
          />
          <button
            class="session-selector__create-go"
            @click=${handleCreateSubmit}
            title="Create agent"
          >Go</button>
        </div>`
        : html`
        <div
          class="session-selector__new-agent"
          @click=${handleShowCreateInput}
        >
          + Fire up new agent...
        </div>`
    }
  `;
}

/** Recomputes options from live state on every render — no stale closures. */
function rerenderDropdown(state: AppViewState) {
  if (!_dropdownContainer) {
    return;
  }
  if (!_dropdownOpen) {
    litRender(nothing, _dropdownContainer);
    return;
  }
  const content = renderDropdownContent(state);
  litRender(html`<div class="session-selector__dropdown">${content}</div>`, _dropdownContainer);
}

// Click-outside listener — stores state ref so it can rerender fresh
let _clickOutsideInstalled = false;
let _lastState: AppViewState | null = null;
function installClickOutside() {
  if (_clickOutsideInstalled) {
    return;
  }
  _clickOutsideInstalled = true;
  document.addEventListener("click", (e) => {
    if (!_dropdownOpen) {
      return;
    }
    const target = e.target as HTMLElement;
    if (target.closest?.(".session-selector")) {
      return;
    }
    closeDropdown();
    if (_dropdownContainer && _lastState) {
      rerenderDropdown(_lastState);
    }
  });
}

export function renderSessionSelector(state: AppViewState) {
  _lastState = state;

  const mainSessionKey = resolveMainSessionKey(state.hello, state.sessionsResult);
  const sessionOptions = resolveSessionOptions(
    state.sessionKey,
    state.sessionsResult,
    mainSessionKey,
    state.agentsList,
  );

  installClickOutside();

  const currentOption = sessionOptions.find((o) => o.key === state.sessionKey);
  const currentLabel = currentOption?.displayName ?? state.sessionKey;

  const handleToggle = (e: Event) => {
    e.stopPropagation();
    if (!state.connected) {
      return;
    }
    _dropdownOpen = !_dropdownOpen;
    _confirmingKey = null;
    _creatingAgent = false;
    const selector = (e.currentTarget as HTMLElement).closest(".session-selector");
    _dropdownContainer = selector?.querySelector(".session-selector__dropdown-anchor") ?? null;
    rerenderDropdown(state);
  };

  return html`
    <div class="session-selector">
      <button
        class="session-selector__trigger"
        ?disabled=${!state.connected}
        @click=${handleToggle}
        title="Switch session"
      >
        ${currentLabel}
      </button>
      <span class="session-selector__chevron">${icons.chevronDown}</span>
      <div class="session-selector__dropdown-anchor"></div>
    </div>
  `;
}

export function renderTab(state: AppViewState, tab: Tab) {
  const href = pathForTab(tab, state.basePath);
  return html`
    <a
      href=${href}
      class="nav-item ${state.tab === tab ? "active" : ""}"
      @click=${(event: MouseEvent) => {
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        ) {
          return;
        }
        event.preventDefault();
        state.setTab(tab);
      }}
      title=${titleForTab(tab)}
    >
      <span class="nav-item__icon" aria-hidden="true">${icons[iconForTab(tab)]}</span>
      <span class="nav-item__text">${titleForTab(tab)}</span>
    </a>
  `;
}

export function renderChatControls(state: AppViewState) {
  const disableThinkingToggle = state.onboarding;
  const disableFocusToggle = state.onboarding;
  const showThinking = state.onboarding ? false : state.settings.chatShowThinking;
  const focusActive = state.onboarding ? true : state.settings.chatFocusMode;
  // Refresh icon
  const refreshIcon = html`
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"></path>
      <path d="M21 3v5h-5"></path>
    </svg>
  `;
  const focusIcon = html`
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M4 7V4h3"></path>
      <path d="M20 7V4h-3"></path>
      <path d="M4 17v3h3"></path>
      <path d="M20 17v3h-3"></path>
      <circle cx="12" cy="12" r="3"></circle>
    </svg>
  `;
  return html`
    <div class="chat-controls">
      <button
        class="btn btn--sm btn--icon"
        ?disabled=${state.chatLoading || !state.connected}
        @click=${() => {
          state.resetToolStream();
          void refreshChat(state as unknown as Parameters<typeof refreshChat>[0]);
        }}
        title="Refresh chat data"
      >
        ${refreshIcon}
      </button>
      <span class="chat-controls__separator">|</span>
      <button
        class="btn btn--sm btn--icon ${showThinking ? "active" : ""}"
        ?disabled=${disableThinkingToggle}
        @click=${() => {
          if (disableThinkingToggle) {
            return;
          }
          state.applySettings({
            ...state.settings,
            chatShowThinking: !state.settings.chatShowThinking,
          });
        }}
        aria-pressed=${showThinking}
        title=${
          disableThinkingToggle
            ? "Disabled during onboarding"
            : "Toggle assistant thinking/working output"
        }
      >
        ${icons.brain}
      </button>
      <button
        class="btn btn--sm btn--icon ${focusActive ? "active" : ""}"
        ?disabled=${disableFocusToggle}
        @click=${() => {
          if (disableFocusToggle) {
            return;
          }
          state.applySettings({
            ...state.settings,
            chatFocusMode: !state.settings.chatFocusMode,
          });
        }}
        aria-pressed=${focusActive}
        title=${
          disableFocusToggle
            ? "Disabled during onboarding"
            : "Toggle focus mode (hide sidebar + page header)"
        }
      >
        ${focusIcon}
      </button>
    </div>
  `;
}

type SessionDefaultsSnapshot = {
  mainSessionKey?: string;
  mainKey?: string;
};

function resolveMainSessionKey(
  hello: AppViewState["hello"],
  sessions: SessionsListResult | null,
): string | null {
  const snapshot = hello?.snapshot as { sessionDefaults?: SessionDefaultsSnapshot } | undefined;
  const mainSessionKey = snapshot?.sessionDefaults?.mainSessionKey?.trim();
  if (mainSessionKey) {
    return mainSessionKey;
  }
  const mainKey = snapshot?.sessionDefaults?.mainKey?.trim();
  if (mainKey) {
    return mainKey;
  }
  if (sessions?.sessions?.some((row) => row.key === "main")) {
    return "main";
  }
  return null;
}

function resolveSessionDisplayName(key: string, row?: SessionsListResult["sessions"][number]) {
  const label = row?.label?.trim();
  if (label) {
    return `${label} (${key})`;
  }
  const displayName = row?.displayName?.trim();
  if (displayName) {
    return displayName;
  }
  return key;
}

function resolveSessionOptions(
  sessionKey: string,
  sessions: SessionsListResult | null,
  mainSessionKey?: string | null,
  agentsList?: AgentsListResult | null,
) {
  const seen = new Set<string>();
  const options: Array<{ key: string; displayName?: string }> = [];

  const resolvedMain = mainSessionKey && sessions?.sessions?.find((s) => s.key === mainSessionKey);
  const resolvedCurrent = sessions?.sessions?.find((s) => s.key === sessionKey);

  // Add main session key first
  if (mainSessionKey) {
    seen.add(mainSessionKey);
    options.push({
      key: mainSessionKey,
      displayName: resolveSessionDisplayName(mainSessionKey, resolvedMain),
    });
  }

  // Add current session key next
  if (!seen.has(sessionKey)) {
    seen.add(sessionKey);
    options.push({
      key: sessionKey,
      displayName: resolveSessionDisplayName(sessionKey, resolvedCurrent),
    });
  }

  // Add sessions from the result
  if (sessions?.sessions) {
    for (const s of sessions.sessions) {
      if (!seen.has(s.key)) {
        seen.add(s.key);
        options.push({
          key: s.key,
          displayName: resolveSessionDisplayName(s.key, s),
        });
      }
    }
  }

  // Merge configured agents so they always appear regardless of activity recency
  if (agentsList?.agents) {
    for (const agent of agentsList.agents) {
      const agentKey = `agent:${agent.id}:main`;
      if (!seen.has(agentKey)) {
        seen.add(agentKey);
        const displayName = agent.name ?? agent.identity?.name ?? agent.id;
        options.push({
          key: agentKey,
          displayName: `${displayName} (${agentKey})`,
        });
      }
    }
  }

  return options;
}

const THEME_ORDER: ThemeMode[] = ["system", "light", "dark"];

export function renderThemeToggle(state: AppViewState) {
  const index = Math.max(0, THEME_ORDER.indexOf(state.theme));
  const applyTheme = (next: ThemeMode) => (event: MouseEvent) => {
    const element = event.currentTarget as HTMLElement;
    const context: ThemeTransitionContext = { element };
    if (event.clientX || event.clientY) {
      context.pointerClientX = event.clientX;
      context.pointerClientY = event.clientY;
    }
    state.setTheme(next, context);
  };

  return html`
    <div class="theme-toggle" style="--theme-index: ${index};">
      <div class="theme-toggle__track" role="group" aria-label="Theme">
        <span class="theme-toggle__indicator"></span>
        <button
          class="theme-toggle__button ${state.theme === "system" ? "active" : ""}"
          @click=${applyTheme("system")}
          aria-pressed=${state.theme === "system"}
          aria-label="System theme"
          title="System"
        >
          ${renderMonitorIcon()}
        </button>
        <button
          class="theme-toggle__button ${state.theme === "light" ? "active" : ""}"
          @click=${applyTheme("light")}
          aria-pressed=${state.theme === "light"}
          aria-label="Light theme"
          title="Light"
        >
          ${renderSunIcon()}
        </button>
        <button
          class="theme-toggle__button ${state.theme === "dark" ? "active" : ""}"
          @click=${applyTheme("dark")}
          aria-pressed=${state.theme === "dark"}
          aria-label="Dark theme"
          title="Dark"
        >
          ${renderMoonIcon()}
        </button>
      </div>
    </div>
  `;
}

function renderSunIcon() {
  return html`
    <svg class="theme-icon" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="4"></circle>
      <path d="M12 2v2"></path>
      <path d="M12 20v2"></path>
      <path d="m4.93 4.93 1.41 1.41"></path>
      <path d="m17.66 17.66 1.41 1.41"></path>
      <path d="M2 12h2"></path>
      <path d="M20 12h2"></path>
      <path d="m6.34 17.66-1.41 1.41"></path>
      <path d="m19.07 4.93-1.41 1.41"></path>
    </svg>
  `;
}

function renderMoonIcon() {
  return html`
    <svg class="theme-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"
      ></path>
    </svg>
  `;
}

function renderMonitorIcon() {
  return html`
    <svg class="theme-icon" viewBox="0 0 24 24" aria-hidden="true">
      <rect width="20" height="14" x="2" y="3" rx="2"></rect>
      <line x1="8" x2="16" y1="21" y2="21"></line>
      <line x1="12" x2="12" y1="17" y2="21"></line>
    </svg>
  `;
}
