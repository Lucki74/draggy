import { describe, expect, it } from "vitest";
import { cronMatches, nextRun, parseSchedule } from "../routines/schedule";
import { dueRoutines, msToNextMinute, runTitle } from "../routines/scheduler";
import { sanitizeRoutines, type Routine } from "../routines/store";

const cronOf = (text: string) => {
  const parsed = parseSchedule(text);
  return parsed.ok ? parsed.cron : null;
};

describe("parseSchedule", () => {
  it("reads plain words", () => {
    expect(cronOf("every day at 9")).toBe("0 9 * * *");
    expect(cronOf("Every weekday at 8:30")).toBe("30 8 * * 1-5");
    expect(cronOf("every monday")).toBe("0 9 * * 1");
    expect(cronOf("every friday at 5pm")).toBe("0 17 * * 5");
    expect(cronOf("every 2 hours")).toBe("0 */2 * * *");
    expect(cronOf("every 15 minutes")).toBe("*/15 * * * *");
    expect(cronOf("hourly")).toBe("0 * * * *");
    expect(cronOf("daily at noon")).toBe("0 12 * * *");
    expect(cronOf("every day at 12am")).toBe("0 0 * * *");
  });

  it("takes a raw five-field cron", () => {
    expect(cronOf("*/5 9-17 * * 1-5")).toBe("*/5 9-17 * * 1-5");
    expect(cronOf("0 0 1,15 * *")).toBe("0 0 1,15 * *");
  });

  it("rejects what it cannot read", () => {
    for (const text of ["", "sometimes", "every day at 25", "every blursday", "61 * * * *", "* * * *", "every 0 hours", "every 30 hours"]) {
      expect(parseSchedule(text).ok, text).toBe(false);
    }
  });

  it("shows the meaning back", () => {
    const parsed = parseSchedule("every weekday at 8:30");
    expect(parsed.ok && parsed.meaning).toEqual({ key: "routineMeanWeekdays", vars: { time: "08:30" } });
    const monday = parseSchedule("every monday");
    expect(monday.ok && monday.meaning).toEqual({ key: "routineMeanDow", vars: { day: "Monday", time: "09:00" } });
  });
});

describe("cron timing", () => {
  const at = (iso: string) => new Date(iso).getTime();

  it("matches the minute", () => {
    expect(cronMatches("30 8 * * 1-5", new Date(2026, 0, 5, 8, 30))).toBe(true);
    expect(cronMatches("30 8 * * 1-5", new Date(2026, 0, 4, 8, 30))).toBe(false);
  });

  it("finds the next slot", () => {
    const next = nextRun("30 8 * * 1-5", new Date(2026, 0, 2, 9, 0).getTime());
    expect(next && new Date(next)).toEqual(new Date(2026, 0, 5, 8, 30));
    expect(nextRun("not cron", at("2026-01-01T00:00:00"))).toBeNull();
  });

  it("is strictly after the given time", () => {
    const from = new Date(2026, 0, 5, 8, 30).getTime();
    const next = nextRun("30 8 * * *", from);
    expect(next && new Date(next)).toEqual(new Date(2026, 0, 6, 8, 30));
  });
});

const routine = (patch: Partial<Routine> = {}): Routine => ({
  id: "r1",
  name: "Digest",
  prompt: "Summarise the repo",
  schedule: "every day at 9",
  cron: "0 9 * * *",
  workspaceId: "w1",
  permissionMode: "acceptEdits",
  enabled: true,
  createdAt: new Date(2026, 0, 1, 12, 0).getTime(),
  lastRunAt: null,
  lastStatus: null,
  lastChatId: null,
  ...patch,
});

describe("dueRoutines", () => {
  it("waits for the slot", () => {
    expect(dueRoutines([routine()], new Date(2026, 0, 2, 8, 59).getTime())).toHaveLength(0);
    expect(dueRoutines([routine()], new Date(2026, 0, 2, 9, 0).getTime())).toHaveLength(1);
  });

  it("catches up one missed run after sleep, once", () => {
    const woke = new Date(2026, 0, 10, 15, 0).getTime();
    expect(dueRoutines([routine()], woke)).toHaveLength(1);
    // After that run starts, the days it missed do not run again.
    expect(dueRoutines([routine({ lastRunAt: woke })], woke + 60_000)).toHaveLength(0);
  });

  it("skips disabled, running, empty and unparsed routines", () => {
    const now = new Date(2026, 0, 10, 15, 0).getTime();
    expect(dueRoutines([routine({ enabled: false })], now)).toHaveLength(0);
    expect(dueRoutines([routine()], now, new Set(["r1"]))).toHaveLength(0);
    expect(dueRoutines([routine({ prompt: "  " })], now)).toHaveLength(0);
    expect(dueRoutines([routine({ cron: "" })], now)).toHaveLength(0);
  });

  it("ticks on the minute and titles the chat", () => {
    expect(msToNextMinute(120_000)).toBe(60_050);
    expect(runTitle("Digest", new Date(2026, 2, 4))).toBe("Digest · 2026-03-04");
  });
});

describe("sanitizeRoutines", () => {
  it("fills what an older save lacks", () => {
    const [saved] = sanitizeRoutines([{ id: "a", name: "Old", prompt: "p", schedule: "hourly", workspaceId: "w" }]);
    expect(saved).toMatchObject({
      cron: "0 * * * *",
      permissionMode: "acceptEdits",
      enabled: true,
      lastRunAt: null,
      lastChatId: null,
    });
  });

  it("never invents a mode above what was saved and resets an unknown one", () => {
    const [saved] = sanitizeRoutines([{ id: "a", schedule: "hourly", permissionMode: "god" }]);
    expect(saved.permissionMode).toBe("acceptEdits");
    const [plan] = sanitizeRoutines([{ id: "a", schedule: "hourly", permissionMode: "plan" }]);
    expect(plan.permissionMode).toBe("plan");
  });

  it("switches off a routine whose schedule does not parse and fails a run cut off by quitting", () => {
    const [bad, cut] = sanitizeRoutines([
      { id: "a", schedule: "whenever", enabled: true },
      { id: "b", schedule: "hourly", lastStatus: "running" },
    ]);
    expect(bad.enabled).toBe(false);
    expect(bad.cron).toBe("");
    expect(cut.lastStatus).toBe("failed");
  });

  it("drops junk and duplicates", () => {
    expect(sanitizeRoutines(null)).toEqual([]);
    expect(sanitizeRoutines([null, 3, { name: "no id" }, { id: "a" }, { id: "a" }])).toHaveLength(1);
  });
});
