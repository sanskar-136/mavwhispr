import { useState, useEffect, useCallback, useRef } from "react";
import { useSettingsStore } from "../stores/settingsStore";
import type {
  CalendarEvent,
  CreateLocalCalendarItemInput,
  UpdateLocalCalendarItemInput,
} from "../types/calendar";
import { hasOtherAttendees } from "../utils/calendarAttendees";

export interface UseUpcomingEventsReturn {
  events: CalendarEvent[];
  isLoading: boolean;
  isConnected: boolean;
  hasExternalConnected: boolean;
  refresh: () => Promise<void>;
  createItem: (
    item: CreateLocalCalendarItemInput
  ) => Promise<{ success: boolean; item?: CalendarEvent; error?: string }>;
  updateItem: (
    id: string,
    updates: UpdateLocalCalendarItemInput
  ) => Promise<{ success: boolean; item?: CalendarEvent; error?: string }>;
  toggleTask: (id: string, isCompleted: boolean) => Promise<{ success: boolean; error?: string }>;
  deleteItem: (id: string) => Promise<{ success: boolean; error?: string }>;
}

export function useUpcomingEvents(): UseUpcomingEventsReturn {
  const gcalAccounts = useSettingsStore((s) => s.gcalAccounts);
  const mcalAccounts = useSettingsStore((s) => s.mcalAccounts);
  const appleCalendarConnected = useSettingsStore((s) => s.appleCalendarConnected);
  const hasExternalConnected =
    gcalAccounts.length > 0 || mcalAccounts.length > 0 || appleCalendarConnected;

  // The local default calendar is always available out of the box!
  const isConnected = true;

  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const hasLoadedRef = useRef(false);

  const fetchEvents = useCallback(async () => {
    if (!hasLoadedRef.current) setIsLoading(true);
    try {
      const now = new Date();
      // Start of today
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
      // 7 full days ahead
      const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7, 23, 59, 59);

      let fetched: CalendarEvent[] = [];
      if (window.electronAPI?.calendarGetWeekSchedule) {
        const res = await window.electronAPI.calendarGetWeekSchedule(
          start.toISOString(),
          end.toISOString()
        );
        if (res?.success && Array.isArray(res.items)) {
          fetched = res.items;
        }
      } else if (window.electronAPI?.gcalGetUpcomingEvents) {
        const res = await window.electronAPI.gcalGetUpcomingEvents(7 * 24 * 60);
        if (res?.success && Array.isArray(res.events)) {
          fetched = res.events;
        }
      }

      const filtered = fetched.filter((e) => {
        if (e.provider === "local" || e.calendar_id === "default") return true;
        if (e.item_type === "task") return true;
        return hasOtherAttendees(e);
      });

      setEvents(filtered);
    } catch {
      setEvents([]);
    } finally {
      hasLoadedRef.current = true;
      setIsLoading(false);
    }
  }, []);

  const createItem = useCallback(
    async (item: CreateLocalCalendarItemInput) => {
      if (!window.electronAPI?.calendarCreateLocalItem) {
        return { success: false, error: "Local calendar not supported" };
      }
      const res = await window.electronAPI.calendarCreateLocalItem(item);
      if (res?.success) {
        await fetchEvents();
      }
      return res;
    },
    [fetchEvents]
  );

  const updateItem = useCallback(
    async (id: string, updates: UpdateLocalCalendarItemInput) => {
      if (!window.electronAPI?.calendarUpdateLocalItem) {
        return { success: false, error: "Local calendar not supported" };
      }
      const res = await window.electronAPI.calendarUpdateLocalItem(id, updates);
      if (res?.success) {
        await fetchEvents();
      }
      return res;
    },
    [fetchEvents]
  );

  const toggleTask = useCallback(
    async (id: string, isCompleted: boolean) => {
      // Optimistic update
      setEvents((prev) =>
        prev.map((e) => (e.id === id ? { ...e, is_completed: isCompleted ? 1 : 0 } : e))
      );
      if (window.electronAPI?.calendarToggleTask) {
        const res = await window.electronAPI.calendarToggleTask(id, isCompleted);
        if (!res?.success) {
          await fetchEvents();
          return res;
        }
      }
      return { success: true };
    },
    [fetchEvents]
  );

  const deleteItem = useCallback(
    async (id: string) => {
      // Optimistic delete
      setEvents((prev) => prev.filter((e) => e.id !== id));
      if (window.electronAPI?.calendarDeleteLocalItem) {
        const res = await window.electronAPI.calendarDeleteLocalItem(id);
        if (!res?.success) {
          await fetchEvents();
          return res;
        }
      }
      return { success: true };
    },
    [fetchEvents]
  );

  // Fetch on mount
  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  // Re-fetch when any provider syncs events
  useEffect(() => {
    const unsubGcal = window.electronAPI?.onGcalEventsSynced?.(() => {
      fetchEvents();
    });
    const unsubMcal = window.electronAPI?.onMcalEventsSynced?.(() => {
      fetchEvents();
    });
    const unsubAcal = window.electronAPI?.onAcalEventsSynced?.(() => {
      fetchEvents();
    });
    const unsubLocal = window.electronAPI?.onCalendarEventsSynced?.(() => {
      fetchEvents();
    });
    return () => {
      unsubGcal?.();
      unsubMcal?.();
      unsubAcal?.();
      unsubLocal?.();
    };
  }, [fetchEvents]);

  return {
    events,
    isLoading,
    isConnected,
    hasExternalConnected,
    refresh: fetchEvents,
    createItem,
    updateItem,
    toggleTask,
    deleteItem,
  };
}
