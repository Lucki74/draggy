import { useCallback, useState } from "react";
import type { ChatSession } from "../types";
import { logSwallow } from "../logger";

export type GroupBy = "folder" | "date" | "status" | "custom" | "none";
export type SortBy = "activity" | "title";

export interface CustomGroup {
  id: string;
  name: string;
}

interface ViewState {
  groupBy: GroupBy;
  sortBy: SortBy;
  groups: CustomGroup[];
  /** Session id to the id of the custom group it sits in. */
  assignments: Record<string, string>;
}

export interface SessionSection {
  id: string;
  label: string;
  sessions: ChatSession[];
  /** Set for a custom group, the only kind that can be deleted. */
  customId?: string;
}

export type ViewMode = "code" | "chat";

const KEYS: Record<ViewMode, string> = { code: "draggy_session_view", chat: "draggy_session_view_chat" };
/** Chats live in no folder, so they cannot be grouped by one. */
const GROUP_BY: Record<ViewMode, GroupBy[]> = {
  code: ["folder", "date", "status", "custom", "none"],
  chat: ["date", "status", "custom", "none"],
};
const SORT_BY: SortBy[] = ["activity", "title"];
const DEFAULTS: Record<ViewMode, ViewState> = {
  code: { groupBy: "folder", sortBy: "activity", groups: [], assignments: {} },
  chat: { groupBy: "date", sortBy: "activity", groups: [], assignments: {} },
};

function read(mode: ViewMode): ViewState {
  try {
    const saved = JSON.parse(localStorage.getItem(KEYS[mode]) || "null") as Partial<ViewState> | null;
    if (!saved) return DEFAULTS[mode];
    return {
      groupBy: GROUP_BY[mode].includes(saved.groupBy as GroupBy) ? (saved.groupBy as GroupBy) : DEFAULTS[mode].groupBy,
      sortBy: SORT_BY.includes(saved.sortBy as SortBy) ? (saved.sortBy as SortBy) : DEFAULTS[mode].sortBy,
      groups: Array.isArray(saved.groups) ? saved.groups.filter((g) => g && g.id && g.name) : [],
      assignments: saved.assignments && typeof saved.assignments === "object" ? saved.assignments : {},
    };
  } catch {
    return DEFAULTS[mode];
  }
}

/** How the sidebar groups and orders sessions, remembered between runs. Code and chat each keep
 * their own choices. */
export function useSessionView(mode: ViewMode = "code") {
  const [states, setStates] = useState<Record<ViewMode, ViewState>>(() => ({ code: read("code"), chat: read("chat") }));
  const state = states[mode];

  const update = useCallback(
    (patch: (current: ViewState) => ViewState) => {
      setStates((all) => {
        const next = patch(all[mode]);
        try {
          localStorage.setItem(KEYS[mode], JSON.stringify(next));
        } catch (error) {
          logSwallow("app", error, "the view still works for this run");
        }
        return { ...all, [mode]: next };
      });
    },
    [mode],
  );

  return {
    ...state,
    setGroupBy: (groupBy: GroupBy) => update((current) => ({ ...current, groupBy })),
    setSortBy: (sortBy: SortBy) => update((current) => ({ ...current, sortBy })),
    /** Returns the new group's id so the caller can put a session in it. */
    addGroup: (name: string) => {
      const id = `g${Date.now().toString(36)}`;
      update((current) => ({ ...current, groups: [...current.groups, { id, name }] }));
      return id;
    },
    removeGroup: (id: string) =>
      update((current) => ({
        ...current,
        groups: current.groups.filter((group) => group.id !== id),
        assignments: Object.fromEntries(Object.entries(current.assignments).filter(([, group]) => group !== id)),
      })),
    assign: (sessionId: string, groupId: string | null) =>
      update((current) => {
        const assignments = { ...current.assignments };
        if (groupId) assignments[sessionId] = groupId;
        else delete assignments[sessionId];
        return { ...current, assignments };
      }),
  };
}

export function sortSessions(sessions: ChatSession[], sortBy: SortBy): ChatSession[] {
  const copy = [...sessions];
  if (sortBy === "title") copy.sort((a, b) => (a.title || "").localeCompare(b.title || "", undefined, { sensitivity: "base" }));
  else copy.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return copy;
}

interface ArrangeInput {
  sessions: ChatSession[];
  groupBy: Exclude<GroupBy, "folder">;
  sortBy: SortBy;
  groups: CustomGroup[];
  assignments: Record<string, string>;
  runningIds: string[];
  t: (key: string) => string;
}

const needsApproval = (session: ChatSession) =>
  session.messages?.some((m) => m.steps?.some((step) => step.type === "approval" && !step.isComplete));

/** The sections the sidebar shows when sessions are not grouped by folder. Pinned ones lead, except
 * with no grouping at all. */
export function arrangeSessions({ sessions, groupBy, sortBy, groups, assignments, runningIds, t }: ArrangeInput): SessionSection[] {
  const sorted = sortSessions(sessions, sortBy);
  if (groupBy === "none") return [{ id: "all", label: "", sessions: sorted }];

  const pinned = sorted.filter((s) => s.pinned);
  const rest = sorted.filter((s) => !s.pinned);
  const sections: SessionSection[] = [];
  if (pinned.length) sections.push({ id: "pinned", label: t("pinned"), sessions: pinned });

  if (groupBy === "date") {
    const dayMs = 24 * 60 * 60 * 1000;
    const todayStart = new Date().setHours(0, 0, 0, 0);
    const buckets: [string, string, number][] = [
      ["today", t("today"), todayStart],
      ["yesterday", t("yesterday"), todayStart - dayMs],
      ["week", t("thisWeek"), todayStart - 6 * dayMs],
      ["earlier", t("earlier"), -Infinity],
    ];
    const taken = new Set<string>();
    for (const [id, label, from] of buckets) {
      const inBucket = rest.filter((s) => !taken.has(s.id) && (s.updatedAt || Date.now()) >= from);
      inBucket.forEach((s) => taken.add(s.id));
      if (inBucket.length) sections.push({ id, label, sessions: inBucket });
    }
  } else if (groupBy === "status") {
    const by = [
      ["running", t("filterRunning"), (s: ChatSession) => runningIds.includes(s.id)],
      ["approval", t("filterApproval"), (s: ChatSession) => Boolean(needsApproval(s))],
      ["unread", t("unread"), (s: ChatSession) => Boolean(s.unread)],
    ] as const;
    const taken = new Set<string>();
    for (const [id, label, test] of by) {
      const inBucket = rest.filter((s) => !taken.has(s.id) && test(s));
      inBucket.forEach((s) => taken.add(s.id));
      if (inBucket.length) sections.push({ id, label, sessions: inBucket });
    }
    const others = rest.filter((s) => !taken.has(s.id));
    if (others.length) sections.push({ id: "done", label: t("groupStatusDone"), sessions: others });
  } else {
    const known = new Set(groups.map((g) => g.id));
    for (const group of groups) {
      sections.push({
        id: group.id,
        customId: group.id,
        label: group.name,
        sessions: rest.filter((s) => assignments[s.id] === group.id),
      });
    }
    const loose = rest.filter((s) => !known.has(assignments[s.id]));
    if (loose.length) sections.push({ id: "ungrouped", label: t("groupUngrouped"), sessions: loose });
  }

  return sections;
}
