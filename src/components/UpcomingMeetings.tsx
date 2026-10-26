import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Calendar,
  CalendarDays,
  Check,
  Clock,
  ExternalLink,
  Loader2,
  Mic,
  Pencil,
  Plus,
  Trash2,
  Video,
} from "./icons";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "./ui/dialog";
import { Input } from "./ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import PersonAvatar from "./ui/PersonAvatar";
import { cn } from "./lib/utils";
import type {
  CalendarAttendee,
  CalendarEvent,
  CalendarItemType,
  CreateLocalCalendarItemInput,
  UpdateLocalCalendarItemInput,
} from "../types/calendar";
import { parseAttendees } from "../utils/calendarAttendees";
import { getMeetingJoinUrl } from "../helpers/meetingJoinUrl";
import { formatTimeRange, parseEventDate } from "../utils/dateFormatting";

interface UpcomingMeetingsProps {
  events: CalendarEvent[];
  isLoading: boolean;
  isConnected: boolean;
  hasExternalConnected?: boolean;
  onConnectCalendar: () => void;
  onCreateItem?: (
    item: CreateLocalCalendarItemInput
  ) => Promise<{ success: boolean; item?: CalendarEvent; error?: string }>;
  onUpdateItem?: (
    id: string,
    updates: UpdateLocalCalendarItemInput
  ) => Promise<{ success: boolean; item?: CalendarEvent; error?: string }>;
  onToggleTask?: (id: string, isCompleted: boolean) => Promise<{ success: boolean; error?: string }>;
  onDeleteItem?: (id: string) => Promise<{ success: boolean; error?: string }>;
}

const openJoinUrl = (url: string) => {
  if (window.electronAPI?.openExternal) {
    window.electronAPI.openExternal(url);
  } else {
    window.open(url, "_blank");
  }
};

const MAX_STACKED_AVATARS = 2;
const ATTENDEE_COUNT_PILL_CLASS =
  "flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-surface-3 px-0.5 text-[9px] font-medium tabular-nums text-muted-foreground ring-1 ring-background";

const RSVP_DOT: Record<string, string> = {
  accepted: "bg-green-500",
  declined: "bg-red-400",
  tentative: "bg-amber-400",
};

function getDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getEventDateKey(event: CalendarEvent): string | null {
  const date = parseEventDate(event.start_time);
  return date ? getDateKey(date) : null;
}

function getTimeString(isoStr?: string): string {
  if (!isoStr) return "10:00";
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return "10:00";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function AttendeePopover({
  event,
  attendees,
  timeRange,
  joinUrl,
}: {
  event: CalendarEvent;
  attendees: CalendarAttendee[];
  timeRange: string;
  joinUrl: string | null;
}) {
  const { t } = useTranslation();

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          aria-label={`${attendees.length} ${t("notes.participants.attendees")}`}
          className="flex shrink-0 items-center -space-x-1 rounded-full outline-none transition-opacity hover:opacity-80 focus-visible:ring-1 focus-visible:ring-ring/40"
        >
          {attendees.slice(0, MAX_STACKED_AVATARS).map((a) => (
            <PersonAvatar
              key={a.email}
              email={a.email}
              displayName={a.displayName}
              size={18}
              className="ring-1 ring-background"
            />
          ))}
          {attendees.length > MAX_STACKED_AVATARS && (
            <span className={ATTENDEE_COUNT_PILL_CLASS}>
              +{attendees.length - MAX_STACKED_AVATARS}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-0">
        <div className="border-b border-border/70 px-3 py-2.5">
          <p dir="auto" className="text-xs font-medium leading-snug text-foreground">
            {event.summary || t("upcoming.untitledEvent")}
          </p>
          <p className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">{timeRange}</p>
        </div>
        <div className="max-h-56 overflow-y-auto p-1">
          {attendees.map((a) => (
            <div key={a.email} className="flex items-center gap-2 rounded-md px-2 py-1.5">
              <PersonAvatar email={a.email} displayName={a.displayName} />
              <div className="min-w-0 flex-1">
                <p dir="auto" className="truncate text-xs text-foreground/80">
                  {a.displayName || a.email.split("@")[0]}
                  {a.self && (
                    <span className="ms-1 text-foreground/45">{t("notes.participants.me")}</span>
                  )}
                </p>
                <p dir="ltr" className="truncate text-[11px] text-foreground/45">
                  {a.email}
                </p>
              </div>
              <span
                className={cn(
                  "h-1.5 w-1.5 shrink-0 rounded-full",
                  RSVP_DOT[a.responseStatus ?? ""] ?? "bg-muted-foreground/25"
                )}
              />
            </div>
          ))}
        </div>
        {joinUrl && (
          <div className="border-t border-border/70 p-1">
            <button
              onClick={() => openJoinUrl(joinUrl)}
              className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs text-foreground/70 transition-colors hover:bg-foreground/5"
            >
              <ExternalLink size={12} className="shrink-0" />
              {t("upcoming.openMeetingLink")}
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function MeetingCard({
  event,
  isNow,
  onEdit,
  onDelete,
}: {
  event: CalendarEvent;
  isNow: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const joinUrl = getMeetingJoinUrl(event);
  const attendees = useMemo(() => parseAttendees(event), [event]);
  const timeRange = formatTimeRange(i18n.language, event.start_time, event.end_time);

  const startNotes = () => {
    if (joinUrl) openJoinUrl(joinUrl);
    window.electronAPI?.joinCalendarMeeting?.(event.id);
  };

  return (
    <div className="group relative flex items-start gap-2.5 rounded-xl border border-border/60 bg-card/60 p-2.5 transition-all hover:border-border dark:bg-surface-2/60">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-500 dark:bg-indigo-500/20">
        {joinUrl ? <Video size={13} /> : <Calendar size={13} />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p
            dir="auto"
            onClick={onEdit}
            className="truncate text-xs font-semibold leading-tight text-foreground cursor-pointer hover:underline"
          >
            {event.summary || t("upcoming.untitledEvent")}
          </p>
          {isNow && (
            <span className="flex items-center gap-1 text-[10px] font-semibold text-emerald-500">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
              </span>
              NOW
            </span>
          )}
        </div>
        <p className="mt-1 flex items-center gap-1 text-[11px] tabular-nums text-muted-foreground">
          <Clock size={10} className="shrink-0 opacity-70" />
          {timeRange}
        </p>

        <div className="mt-2 flex items-center gap-2">
          {joinUrl ? (
            <Button
              size="sm"
              variant="outline"
              onClick={startNotes}
              className="h-6 px-2.5 text-[11px] font-medium"
            >
              <Video size={11} className="me-1 text-primary" />
              Join
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              onClick={startNotes}
              className="h-6 px-2 text-[11px] text-muted-foreground hover:text-foreground"
            >
              <Mic size={11} className="me-1" />
              Notes
            </Button>
          )}

          {attendees.length > 0 && (
            <div className="ms-auto">
              <AttendeePopover
                event={event}
                attendees={attendees}
                timeRange={timeRange}
                joinUrl={joinUrl}
              />
            </div>
          )}
        </div>
      </div>

      <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1 transition-opacity">
        {onEdit && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
            className="p-1 text-muted-foreground/60 hover:text-foreground hover:bg-surface-3 rounded transition-all"
            title="Edit meeting"
          >
            <Pencil size={11} />
          </button>
        )}
        {onDelete && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="p-1 text-muted-foreground/60 hover:text-destructive hover:bg-destructive/10 rounded transition-all"
            title="Delete meeting"
          >
            <Trash2 size={11} />
          </button>
        )}
      </div>
    </div>
  );
}

function TaskCard({
  task,
  onToggle,
  onEdit,
  onDelete,
}: {
  task: CalendarEvent;
  onToggle?: (isCompleted: boolean) => void;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const isCompleted = !!task.is_completed;
  const time = task.is_all_day
    ? null
    : formatTimeRange("en", task.start_time, task.end_time || task.start_time);

  return (
    <div
      onClick={() => onToggle?.(!isCompleted)}
      className={cn(
        "group flex cursor-pointer items-start gap-2.5 rounded-xl border p-2.5 transition-all select-none",
        isCompleted
          ? "border-border/40 bg-card/30 opacity-70 dark:bg-surface-2/30"
          : "border-border/60 bg-card/60 hover:border-border dark:bg-surface-2/60"
      )}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggle?.(!isCompleted);
        }}
        className={cn(
          "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-all",
          isCompleted
            ? "border-emerald-500 bg-emerald-500 text-white dark:border-emerald-500"
            : "border-muted-foreground/40 bg-background hover:border-emerald-500"
        )}
      >
        {isCompleted && <Check size={10} className="stroke-[3]" />}
      </button>

      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "text-xs font-medium leading-snug transition-all truncate",
            isCompleted ? "line-through text-muted-foreground/60" : "text-foreground"
          )}
        >
          {task.summary || "Untitled Task"}
        </p>

        <div className="mt-1 flex items-center gap-1.5">
          {time && (
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground tabular-nums">
              <Clock size={9} />
              {time}
            </span>
          )}

          {task.priority && (
            <span
              className={cn(
                "rounded px-1 text-[9px] font-semibold uppercase tracking-wider",
                task.priority === "high" &&
                  "bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20",
                task.priority === "medium" &&
                  "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20",
                task.priority === "low" &&
                  "bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20"
              )}
            >
              {task.priority}
            </span>
          )}
        </div>
      </div>

      <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1 transition-opacity">
        {onEdit && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
            className="p-1 text-muted-foreground/60 hover:text-foreground hover:bg-surface-3 rounded transition-all"
            title="Edit task"
          >
            <Pencil size={11} />
          </button>
        )}
        {onDelete && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="p-1 text-muted-foreground/60 hover:text-destructive hover:bg-destructive/10 rounded transition-all"
            title="Delete task"
          >
            <Trash2 size={11} />
          </button>
        )}
      </div>
    </div>
  );
}

function ItemEditModal({
  event,
  open,
  onOpenChange,
  onSave,
  onDelete,
}: {
  event: CalendarEvent | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (id: string, updates: UpdateLocalCalendarItemInput) => Promise<unknown>;
  onDelete?: (id: string) => Promise<unknown>;
}) {
  const [summary, setSummary] = useState("");
  const [dateStr, setDateStr] = useState("");
  const [startTime, setStartTime] = useState("10:00");
  const [endTime, setEndTime] = useState("10:45");
  const [meetingUrl, setMeetingUrl] = useState("");
  const [priority, setPriority] = useState<"low" | "medium" | "high">("medium");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (event) {
      setSummary(event.summary || "");
      const d = parseEventDate(event.start_time) || new Date();
      setDateStr(getDateKey(d));
      setStartTime(getTimeString(event.start_time));
      setEndTime(getTimeString(event.end_time));
      setMeetingUrl(event.hangout_link || "");
      setPriority(event.priority || "medium");
    }
  }, [event]);

  if (!event) return null;
  const isMeeting = (event.item_type || "meeting") === "meeting";

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!summary.trim()) return;

    setIsSubmitting(true);
    try {
      let startIso: string;
      let endIso: string;

      if (isMeeting) {
        const [sh, sm] = startTime.split(":").map(Number);
        const [eh, em] = endTime.split(":").map(Number);
        const s = new Date(`${dateStr}T00:00:00`);
        s.setHours(sh || 9, sm || 0, 0, 0);
        const end = new Date(`${dateStr}T00:00:00`);
        end.setHours(eh || (sh || 9) + 1, em || 0, 0, 0);
        startIso = s.toISOString();
        endIso = end.toISOString();
      } else {
        const s = new Date(`${dateStr}T00:00:00`);
        const [h, m] = startTime.split(":").map(Number);
        s.setHours(h || 12, m || 0, 0, 0);
        startIso = s.toISOString();
        endIso = s.toISOString();
      }

      await onSave(event.id, {
        id: event.id,
        summary: summary.trim(),
        start_time: startIso,
        end_time: endIso,
        hangout_link: meetingUrl.trim() || undefined,
        priority: !isMeeting ? priority : undefined,
      });
      onOpenChange(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit {isMeeting ? "Meeting" : "Task"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleUpdate} className="space-y-4 pt-2">
          <div>
            <label className="text-[11px] font-medium text-muted-foreground">Title</label>
            <Input
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              autoFocus
              className="mt-1"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-medium text-muted-foreground">Date</label>
              <Input
                type="date"
                value={dateStr}
                onChange={(e) => setDateStr(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-[11px] font-medium text-muted-foreground">
                {isMeeting ? "Start Time" : "Due Time"}
              </label>
              <Input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="mt-1"
              />
            </div>
          </div>

          {isMeeting && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-medium text-muted-foreground">End Time</label>
                <Input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-[11px] font-medium text-muted-foreground">Meeting Link</label>
                <Input
                  value={meetingUrl}
                  onChange={(e) => setMeetingUrl(e.target.value)}
                  placeholder="Zoom / Meet / Teams URL"
                  className="mt-1"
                />
              </div>
            </div>
          )}

          {!isMeeting && (
            <div>
              <label className="text-[11px] font-medium text-muted-foreground">Priority</label>
              <div className="mt-1.5 flex gap-2">
                {(["low", "medium", "high"] as const).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPriority(p)}
                    className={cn(
                      "flex-1 rounded-lg border py-1 text-xs font-medium capitalize transition-all",
                      priority === p
                        ? "border-primary bg-primary/10 text-primary font-semibold"
                        : "border-border text-muted-foreground hover:bg-surface-2"
                    )}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          )}

          <DialogFooter className="flex items-center justify-between pt-2">
            {onDelete && (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={async () => {
                  await onDelete(event.id);
                  onOpenChange(false);
                }}
                disabled={isSubmitting}
                className="me-auto"
              >
                <Trash2 size={12} className="me-1" />
                Delete
              </Button>
            )}

            <div className="flex gap-2 ms-auto">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onOpenChange(false)}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={!summary.trim() || isSubmitting}>
                {isSubmitting ? <Loader2 size={12} className="animate-spin" /> : "Save Changes"}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AddScheduleItemDialog({
  open,
  onOpenChange,
  defaultDateKey,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultDateKey: string;
  onAdd: (item: CreateLocalCalendarItemInput) => Promise<unknown>;
}) {
  const [itemType, setItemType] = useState<CalendarItemType>("meeting");
  const [summary, setSummary] = useState("");
  const [dateStr, setDateStr] = useState(defaultDateKey);
  const [startTime, setStartTime] = useState("10:00");
  const [endTime, setEndTime] = useState("10:45");
  const [meetingUrl, setMeetingUrl] = useState("");
  const [priority, setPriority] = useState<"low" | "medium" | "high">("medium");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setDateStr(defaultDateKey);
      setSummary("");
      setMeetingUrl("");
      setPriority("medium");
    }
  }, [open, defaultDateKey]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!summary.trim()) return;

    setIsSubmitting(true);
    try {
      let startIso: string;
      let endIso: string;

      if (itemType === "meeting") {
        const [sh, sm] = startTime.split(":").map(Number);
        const [eh, em] = endTime.split(":").map(Number);
        const s = new Date(`${dateStr}T00:00:00`);
        s.setHours(sh || 9, sm || 0, 0, 0);
        const end = new Date(`${dateStr}T00:00:00`);
        end.setHours(eh || (sh || 9) + 1, em || 0, 0, 0);
        startIso = s.toISOString();
        endIso = end.toISOString();
      } else {
        const s = new Date(`${dateStr}T00:00:00`);
        const [h, m] = startTime.split(":").map(Number);
        s.setHours(h || 12, m || 0, 0, 0);
        startIso = s.toISOString();
        endIso = s.toISOString();
      }

      await onAdd({
        summary: summary.trim(),
        item_type: itemType,
        start_time: startIso,
        end_time: endIso,
        hangout_link: meetingUrl.trim() || undefined,
        priority: itemType === "task" ? priority : undefined,
      });
      onOpenChange(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add to Calendar</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          {/* Segmented Control */}
          <div className="flex rounded-xl bg-surface-3 p-1 dark:bg-surface-1">
            <button
              type="button"
              onClick={() => setItemType("meeting")}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium transition-all",
                itemType === "meeting"
                  ? "bg-background text-foreground shadow-xs font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Video size={13} className="text-indigo-500" />
              Meeting
            </button>
            <button
              type="button"
              onClick={() => setItemType("task")}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium transition-all",
                itemType === "task"
                  ? "bg-background text-foreground shadow-xs font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Check size={13} className="text-emerald-500" />
              Task / To-Do
            </button>
          </div>

          <div>
            <label className="text-[11px] font-medium text-muted-foreground">Title</label>
            <Input
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder={
                itemType === "meeting" ? "e.g. Design review with team" : "e.g. Review PR #2884"
              }
              autoFocus
              className="mt-1"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-medium text-muted-foreground">Date</label>
              <Input
                type="date"
                value={dateStr}
                onChange={(e) => setDateStr(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-[11px] font-medium text-muted-foreground">
                {itemType === "meeting" ? "Start Time" : "Due Time"}
              </label>
              <Input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="mt-1"
              />
            </div>
          </div>

          {itemType === "meeting" && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-medium text-muted-foreground">End Time</label>
                <Input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-[11px] font-medium text-muted-foreground">Meeting Link</label>
                <Input
                  value={meetingUrl}
                  onChange={(e) => setMeetingUrl(e.target.value)}
                  placeholder="Zoom / Meet / Teams URL"
                  className="mt-1"
                />
              </div>
            </div>
          )}

          {itemType === "task" && (
            <div>
              <label className="text-[11px] font-medium text-muted-foreground">Priority</label>
              <div className="mt-1.5 flex gap-2">
                {(["low", "medium", "high"] as const).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPriority(p)}
                    className={cn(
                      "flex-1 rounded-lg border py-1 text-xs font-medium capitalize transition-all",
                      priority === p
                        ? "border-primary bg-primary/10 text-primary font-semibold"
                        : "border-border text-muted-foreground hover:bg-surface-2"
                    )}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          )}

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={!summary.trim() || isSubmitting}>
              {isSubmitting ? (
                <Loader2 size={12} className="animate-spin" />
              ) : itemType === "meeting" ? (
                "Create Meeting"
              ) : (
                "Create Task"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type FilterMode = "all" | "meetings" | "tasks" | "pending" | "completed";

export default function UpcomingMeetings({
  events,
  isLoading,
  isConnected: _isConnected,
  hasExternalConnected = false,
  onConnectCalendar,
  onCreateItem,
  onUpdateItem,
  onToggleTask,
  onDeleteItem,
}: UpcomingMeetingsProps) {
  const { t, i18n } = useTranslation();
  const now = useMemo(() => new Date(), []);
  const todayKey = useMemo(() => getDateKey(now), [now]);

  const [selectedDayKey, setSelectedDayKey] = useState<string>(todayKey);
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);

  // Generate 7-day strip from today
  const weekDays = useMemo(() => {
    const list = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
      const key = getDateKey(d);

      const dayEvents = events.filter((e) => getEventDateKey(e) === key);
      const meetingCount = dayEvents.filter(
        (e) => (e.item_type || "meeting") === "meeting"
      ).length;
      const taskCount = dayEvents.filter((e) => e.item_type === "task").length;

      list.push({
        date: d,
        key,
        dayName: d.toLocaleDateString(i18n.language || "en", { weekday: "short" }),
        dayNumber: d.getDate(),
        isToday: i === 0,
        meetingCount,
        taskCount,
      });
    }
    return list;
  }, [events, now, i18n.language]);

  // Active items for selected day (or all week)
  const activeItems = useMemo(() => {
    let base = events;
    if (selectedDayKey !== "all") {
      base = events.filter((e) => getEventDateKey(e) === selectedDayKey);
    }

    if (filterMode === "meetings") {
      return base.filter((e) => (e.item_type || "meeting") === "meeting");
    }
    if (filterMode === "tasks") {
      return base.filter((e) => e.item_type === "task");
    }
    if (filterMode === "pending") {
      return base.filter((e) => e.item_type === "task" && !e.is_completed);
    }
    if (filterMode === "completed") {
      return base.filter((e) => e.item_type === "task" && !!e.is_completed);
    }
    return base;
  }, [events, selectedDayKey, filterMode]);

  const activeMeetings = useMemo(() => {
    return activeItems.filter((e) => (e.item_type || "meeting") === "meeting");
  }, [activeItems]);

  const activeTasks = useMemo(() => {
    return activeItems.filter((e) => e.item_type === "task");
  }, [activeItems]);

  const isNowFn = (event: CalendarEvent) => {
    const start = new Date(event.start_time);
    const end = new Date(event.end_time || event.start_time);
    return start <= now && now <= end;
  };

  const selectedDayObj = weekDays.find((d) => d.key === selectedDayKey);
  const dayTitle =
    selectedDayKey === "all"
      ? "All Week"
      : selectedDayObj?.isToday
      ? "Today"
      : selectedDayObj?.date.toLocaleDateString(i18n.language || "en", {
          weekday: "short",
          month: "short",
          day: "numeric",
        });

  return (
    <div className="flex flex-col gap-3">
      {/* Top Header Card */}
      <div className="rounded-2xl border border-border/70 bg-card/60 p-3 shadow-xs dark:border-white/10 dark:bg-surface-2/60">
        <div className="flex items-center justify-between pb-2.5">
          <div className="flex items-center gap-1.5">
            <CalendarDays size={14} className="text-primary" />
            <span className="text-xs font-semibold text-foreground tracking-tight">
              Default Calendar
            </span>
          </div>

          <Button
            size="sm"
            onClick={() => setAddDialogOpen(true)}
            className="h-6 gap-1 px-2 text-[11px] font-medium"
          >
            <Plus size={12} />
            <span>Add</span>
          </Button>
        </div>

        {/* 7-Day Quick Strip */}
        <div className="grid grid-cols-7 gap-1 pt-1">
          {weekDays.map((d) => {
            const isSelected = selectedDayKey === d.key;
            return (
              <button
                key={d.key}
                type="button"
                onClick={() => setSelectedDayKey(d.key)}
                className={cn(
                  "flex flex-col items-center justify-center rounded-xl py-1.5 transition-all select-none",
                  isSelected
                    ? "bg-primary text-primary-foreground font-semibold shadow-xs"
                    : d.isToday
                    ? "border border-primary/40 bg-primary/5 text-foreground hover:bg-primary/10"
                    : "text-muted-foreground hover:bg-surface-3 hover:text-foreground dark:hover:bg-surface-3"
                )}
              >
                <span className="text-[10px] uppercase font-medium">{d.dayName.slice(0, 3)}</span>
                <span className="mt-0.5 text-xs font-bold leading-tight">{d.dayNumber}</span>

                {/* Density dots */}
                <div className="mt-1 flex h-1.5 items-center gap-0.5">
                  {d.meetingCount > 0 && (
                    <span
                      className={cn(
                        "h-1 w-1 rounded-full",
                        isSelected ? "bg-white" : "bg-indigo-500"
                      )}
                    />
                  )}
                  {d.taskCount > 0 && (
                    <span
                      className={cn(
                        "h-1 w-1 rounded-full",
                        isSelected ? "bg-white" : "bg-emerald-500"
                      )}
                    />
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {/* Strip Footer / All Week Toggle */}
        <div className="flex items-center justify-between pt-2 text-[11px] text-muted-foreground">
          <span>{dayTitle}</span>
          <button
            type="button"
            onClick={() => setSelectedDayKey(selectedDayKey === "all" ? todayKey : "all")}
            className="hover:text-primary transition-colors cursor-pointer"
          >
            {selectedDayKey === "all" ? "View Today" : "View All Week"}
          </button>
        </div>

        {/* Filter Pills */}
        <div className="flex items-center gap-1 overflow-x-auto pt-2 text-xs no-scrollbar border-t border-border/40 mt-2">
          {(
            [
              { id: "all", label: "All" },
              { id: "meetings", label: "Meetings" },
              { id: "tasks", label: "Tasks" },
              { id: "pending", label: "Pending" },
              { id: "completed", label: "Done" },
            ] as const
          ).map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilterMode(f.id)}
              className={cn(
                "rounded-full px-2.5 py-0.5 text-[10px] font-medium transition-all shrink-0 cursor-pointer",
                filterMode === f.id
                  ? "bg-primary/10 text-primary border border-primary/30 font-semibold"
                  : "text-muted-foreground hover:bg-surface-3 hover:text-foreground border border-transparent"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Loading state */}
      {isLoading && (
        <div className="flex items-center justify-center gap-2 py-4">
          <Loader2 size={14} className="animate-spin text-primary" />
        </div>
      )}

      {/* Segregated Schedule Sections */}
      {!isLoading && (
        <div className="space-y-3">
          {/* 1. MEETINGS SECTION (only when filter includes meetings) */}
          {(filterMode === "all" || filterMode === "meetings") && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between px-1">
                <span className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                  <Video size={12} className="text-indigo-500" />
                  Meetings
                  <span className="text-[10px] font-normal text-muted-foreground">
                    ({activeMeetings.length})
                  </span>
                </span>

                <button
                  type="button"
                  onClick={() => setAddDialogOpen(true)}
                  className="text-[11px] text-primary hover:underline cursor-pointer"
                >
                  + Meeting
                </button>
              </div>

              {activeMeetings.length > 0 ? (
                <div className="space-y-1.5">
                  {activeMeetings.map((event) => (
                    <MeetingCard
                      key={event.id}
                      event={event}
                      isNow={isNowFn(event)}
                      onEdit={() => setEditingEvent(event)}
                      onDelete={
                        event.provider === "local" || event.calendar_id === "default"
                          ? () => onDeleteItem?.(event.id)
                          : undefined
                      }
                    />
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-border/70 p-3 text-center text-xs text-muted-foreground/70">
                  No meetings scheduled
                </div>
              )}
            </div>
          )}

          {/* 2. TASKS & TO-DOS SECTION (only when filter includes tasks) */}
          {filterMode !== "meetings" && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between px-1">
                <span className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                  <Check size={12} className="text-emerald-500" />
                  Tasks & To-Dos
                  <span className="text-[10px] font-normal text-muted-foreground">
                    ({activeTasks.filter((t) => t.is_completed).length}/{activeTasks.length})
                  </span>
                </span>

                <button
                  type="button"
                  onClick={() => setAddDialogOpen(true)}
                  className="text-[11px] text-primary hover:underline cursor-pointer"
                >
                  + Task
                </button>
              </div>

              {activeTasks.length > 0 ? (
                <div className="space-y-1.5">
                  {activeTasks.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      onToggle={(completed) => onToggleTask?.(task.id, completed)}
                      onEdit={() => setEditingEvent(task)}
                      onDelete={
                        task.provider === "local" || task.calendar_id === "default"
                          ? () => onDeleteItem?.(task.id)
                          : undefined
                      }
                    />
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-border/70 p-3 text-center text-xs text-muted-foreground/70">
                  No tasks matching filter
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Cloud Calendar Sync Footer Hint */}
      {!hasExternalConnected && (
        <div className="mt-1 rounded-xl bg-surface-3/50 p-2.5 text-center text-[11px] text-muted-foreground dark:bg-surface-2/40">
          <span>Connect Google or Outlook calendar? </span>
          <button
            type="button"
            onClick={onConnectCalendar}
            className="text-primary font-medium hover:underline cursor-pointer"
          >
            Connect
          </button>
        </div>
      )}

      {/* Dialog for adding new Meetings and Tasks */}
      <AddScheduleItemDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        defaultDateKey={selectedDayKey === "all" ? todayKey : selectedDayKey}
        onAdd={async (item) => {
          if (onCreateItem) return onCreateItem(item);
        }}
      />

      {/* Dialog for editing an existing Meeting or Task */}
      <ItemEditModal
        event={editingEvent}
        open={!!editingEvent}
        onOpenChange={(open) => {
          if (!open) setEditingEvent(null);
        }}
        onSave={async (id, updates) => {
          if (onUpdateItem) return onUpdateItem(id, updates);
        }}
        onDelete={
          editingEvent?.provider === "local" || editingEvent?.calendar_id === "default"
            ? async (id) => onDeleteItem?.(id)
            : undefined
        }
      />
    </div>
  );
}
