import type { ToolDefinition, ToolResult } from "./ToolRegistry";
import { getMeetingJoinUrl } from "../../helpers/meetingJoinUrl";

type TimeRange = "today" | "tomorrow" | "week";

function getWindowMinutes(timeRange: TimeRange): number {
  if (timeRange === "week") return 10080;

  const now = new Date();
  if (timeRange === "tomorrow") {
    const endOfTomorrow = new Date(now);
    endOfTomorrow.setDate(endOfTomorrow.getDate() + 1);
    endOfTomorrow.setHours(23, 59, 59, 999);
    return Math.ceil((endOfTomorrow.getTime() - now.getTime()) / 60000);
  }

  // "today": remaining minutes until midnight
  const midnight = new Date(now);
  midnight.setHours(23, 59, 59, 999);
  return Math.max(1, Math.ceil((midnight.getTime() - now.getTime()) / 60000));
}

function parseDateParam(dateStr?: string): Date {
  const now = new Date();
  if (!dateStr || dateStr.toLowerCase() === "today") {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }
  if (dateStr.toLowerCase() === "tomorrow") {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  }
  const parsed = new Date(dateStr);
  if (!isNaN(parsed.getTime())) return parsed;
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function parseTimeParam(timeStr?: string): { hours: number; minutes: number } {
  if (!timeStr) return { hours: 10, minutes: 0 };
  const match = timeStr.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (match) {
    let hours = parseInt(match[1], 10);
    const minutes = match[2] ? parseInt(match[2], 10) : 0;
    const meridian = match[3]?.toLowerCase();
    if (meridian === "pm" && hours < 12) hours += 12;
    if (meridian === "am" && hours === 12) hours = 0;
    return { hours, minutes };
  }
  return { hours: 10, minutes: 0 };
}

export const calendarTool: ToolDefinition = {
  name: "get_calendar_events",
  description:
    "Get upcoming events and tasks from the user's default calendar and connected providers for a given time range (today, tomorrow, or week).",
  parameters: {
    type: "object",
    properties: {
      timeRange: {
        type: "string",
        enum: ["today", "tomorrow", "week"],
        description: 'Time range to fetch events for (default "today")',
      },
    },
    required: [],
    additionalProperties: false,
  },
  readOnly: true,

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const timeRange = (args.timeRange as TimeRange) || "today";
    const windowMinutes = getWindowMinutes(timeRange);

    try {
      const response = await window.electronAPI.gcalGetUpcomingEvents!(windowMinutes);

      if (!response.success) {
        return {
          success: false,
          data: null,
          displayText: "Failed to fetch calendar events",
        };
      }

      const events = response.events.map((event: Record<string, unknown>) => ({
        id: event.id,
        summary: event.summary || "(No title)",
        item_type: event.item_type || "meeting",
        is_completed: !!event.is_completed,
        priority: event.priority || "medium",
        start: event.start_time,
        end: event.end_time,
        joinUrl: getMeetingJoinUrl(event),
      }));

      if (events.length === 0) {
        return {
          success: true,
          data: [],
          displayText: `No meetings or tasks scheduled for ${timeRange}`,
        };
      }

      const meetings = events.filter((e: any) => e.item_type === "meeting");
      const tasks = events.filter((e: any) => e.item_type === "task");

      return {
        success: true,
        data: events,
        displayText: `Found ${meetings.length} meeting${meetings.length === 1 ? "" : "s"} and ${tasks.length} task${tasks.length === 1 ? "" : "s"} for ${timeRange}.`,
      };
    } catch (error) {
      return {
        success: false,
        data: null,
        displayText: `Failed to fetch calendar events: ${(error as Error).message}`,
      };
    }
  },
};

export const createCalendarItemTool: ToolDefinition = {
  name: "create_calendar_item",
  description:
    "Create a new meeting or add a task to the user's local default calendar. Use this when the user asks to schedule a meeting, set an appointment, add a task, or set a reminder.",
  parameters: {
    type: "object",
    properties: {
      summary: {
        type: "string",
        description: "Title or description of the meeting or task (e.g. 'Sync with Alex' or 'Review PR #2884')",
      },
      item_type: {
        type: "string",
        enum: ["meeting", "task"],
        description: "Whether this is a 'meeting' or a 'task' (to-do item). Default is 'meeting'.",
      },
      date: {
        type: "string",
        description: "Date for the item. Can be 'today', 'tomorrow', or 'YYYY-MM-DD'. Defaults to 'today'.",
      },
      time: {
        type: "string",
        description: "Start time for meetings or due time for tasks (e.g. '14:00' or '2:30 PM').",
      },
      duration_minutes: {
        type: "number",
        description: "Duration in minutes for meetings (default 45).",
      },
      hangout_link: {
        type: "string",
        description: "Optional video call or meeting link (Zoom, Google Meet, Teams).",
      },
      priority: {
        type: "string",
        enum: ["low", "medium", "high"],
        description: "Priority level for tasks ('low', 'medium', 'high'). Defaults to 'medium'.",
      },
    },
    required: ["summary"],
    additionalProperties: false,
  },
  readOnly: false,

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const summary = String(args.summary || "").trim();
    if (!summary) {
      return { success: false, data: null, displayText: "Missing item summary/title" };
    }

    const itemType = (args.item_type as "meeting" | "task") || "meeting";
    const targetDate = parseDateParam(args.date as string | undefined);
    const { hours, minutes } = parseTimeParam(args.time as string | undefined);
    targetDate.setHours(hours, minutes, 0, 0);

    const duration = Number(args.duration_minutes) || (itemType === "meeting" ? 45 : 0);
    const endDate = new Date(targetDate.getTime() + duration * 60000);

    try {
      if (!window.electronAPI?.calendarCreateLocalItem) {
        return { success: false, data: null, displayText: "Local calendar API not available" };
      }

      const res = await window.electronAPI.calendarCreateLocalItem({
        summary,
        item_type: itemType,
        start_time: targetDate.toISOString(),
        end_time: endDate.toISOString(),
        hangout_link: (args.hangout_link as string) || undefined,
        priority: (args.priority as "low" | "medium" | "high") || "medium",
        is_all_day: !args.time && itemType === "task",
      });

      if (!res.success) {
        return {
          success: false,
          data: null,
          displayText: `Failed to create calendar ${itemType}: ${res.error || "Unknown error"}`,
        };
      }

      const timeStr = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
      const typeLabel = itemType === "meeting" ? "Meeting" : "Task";
      const displayText = `Scheduled ${typeLabel}: "${summary}" for ${targetDate.toLocaleDateString()} at ${timeStr}.`;

      return {
        success: true,
        data: res.item,
        displayText,
      };
    } catch (error) {
      return {
        success: false,
        data: null,
        displayText: `Error scheduling calendar item: ${(error as Error).message}`,
      };
    }
  },
};

export const toggleCalendarTaskTool: ToolDefinition = {
  name: "toggle_calendar_task",
  description: "Mark a calendar task as completed or pending by its task ID.",
  parameters: {
    type: "object",
    properties: {
      task_id: {
        type: "string",
        description: "The unique ID of the calendar task.",
      },
      completed: {
        type: "boolean",
        description: "True to mark task completed; false to mark incomplete.",
      },
    },
    required: ["task_id", "completed"],
    additionalProperties: false,
  },
  readOnly: false,

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const taskId = String(args.task_id || "");
    const completed = Boolean(args.completed);

    try {
      if (!window.electronAPI?.calendarToggleTask) {
        return { success: false, data: null, displayText: "Local calendar API not available" };
      }

      const res = await window.electronAPI.calendarToggleTask(taskId, completed);
      if (!res.success) {
        return {
          success: false,
          data: null,
          displayText: `Failed to toggle task: ${res.error || "Unknown error"}`,
        };
      }

      return {
        success: true,
        data: { id: taskId, completed },
        displayText: `Task marked as ${completed ? "completed" : "pending"}.`,
      };
    } catch (error) {
      return {
        success: false,
        data: null,
        displayText: `Error toggling task: ${(error as Error).message}`,
      };
    }
  },
};
