import { getSetting } from './db.ts';

export interface BusinessHours {
  start: string;
  end: string;
  days: number[];
}

export interface SlaConfig {
  hours: BusinessHours;
  holidays: string[];
  priorityFactor: Record<string, number>;
  pauseStatuses: string[];
  defaultHours: number;
}

export interface SlaState {
  status: 'on_track' | 'due_soon' | 'overdue' | 'paused' | 'met' | 'breached';
  dueAt: string | null;
  targetMinutes: number;
  remainingMinutes: number;
  pausedMinutes: number;
  progress: number;
}

export const defaultSlaConfig: SlaConfig = {
  hours: { start: '08:00', end: '18:00', days: [1, 2, 3, 4, 5] },
  holidays: [],
  priorityFactor: { Baixa: 1.5, Normal: 1, Alta: 0.5, Urgente: 0.25 },
  pauseStatuses: ['Aguardando cliente', 'Aguardando transportadora', 'Aguardando motorista'],
  defaultHours: 48
};

export function loadSlaConfig(companyId: string): SlaConfig {
  const hours = getSetting<BusinessHours>(companyId, 'business_hours', defaultSlaConfig.hours);
  return {
    hours: {
      start: /^\d{2}:\d{2}$/.test(hours.start) ? hours.start : defaultSlaConfig.hours.start,
      end: /^\d{2}:\d{2}$/.test(hours.end) ? hours.end : defaultSlaConfig.hours.end,
      days: Array.isArray(hours.days) && hours.days.length ? hours.days : defaultSlaConfig.hours.days
    },
    holidays: getSetting<string[]>(companyId, 'holidays', []),
    priorityFactor: getSetting<Record<string, number>>(companyId, 'sla_priority_factor', defaultSlaConfig.priorityFactor),
    pauseStatuses: getSetting<string[]>(companyId, 'sla_pause_statuses', defaultSlaConfig.pauseStatuses),
    defaultHours: Number(getSetting<number>(companyId, 'sla_default_hours', defaultSlaConfig.defaultHours)) || defaultSlaConfig.defaultHours
  };
}

function toMinutes(value: string): number {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

export function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isBusinessDay(date: Date, config: SlaConfig): boolean {
  return config.hours.days.includes(date.getDay()) && !config.holidays.includes(dateKey(date));
}

function windowFor(date: Date, config: SlaConfig): { start: Date; end: Date } | null {
  if (!isBusinessDay(date, config)) return null;
  const start = new Date(date);
  start.setHours(Math.floor(toMinutes(config.hours.start) / 60), toMinutes(config.hours.start) % 60, 0, 0);
  const end = new Date(date);
  end.setHours(Math.floor(toMinutes(config.hours.end) / 60), toMinutes(config.hours.end) % 60, 0, 0);
  if (end <= start) return null;
  return { start, end };
}

export function businessMinutesBetween(startIso: string, endIso: string, config: SlaConfig): number {
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return 0;
  let total = 0;
  const cursor = new Date(start);
  cursor.setHours(0, 0, 0, 0);
  for (let guard = 0; guard < 800 && cursor <= end; guard += 1) {
    const window = windowFor(cursor, config);
    if (window) {
      const from = new Date(Math.max(start.getTime(), window.start.getTime()));
      const to = new Date(Math.min(end.getTime(), window.end.getTime()));
      if (to > from) total += (to.getTime() - from.getTime()) / 60000;
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return Math.floor(total);
}

export function addBusinessMinutes(startIso: string, minutes: number, config: SlaConfig): string {
  const cursor = new Date(startIso);
  if (Number.isNaN(cursor.getTime())) return startIso;
  let remaining = Math.max(0, Math.floor(minutes));
  for (let guard = 0; guard < 800 && remaining > 0; guard += 1) {
    const window = windowFor(cursor, config);
    if (!window || cursor >= window.end) {
      cursor.setDate(cursor.getDate() + 1);
      cursor.setHours(0, 0, 0, 0);
      continue;
    }
    if (cursor < window.start) cursor.setTime(window.start.getTime());
    const available = (window.end.getTime() - cursor.getTime()) / 60000;
    if (available <= remaining) {
      remaining -= available;
      cursor.setTime(window.end.getTime());
      if (remaining > 0) {
        cursor.setDate(cursor.getDate() + 1);
        cursor.setHours(0, 0, 0, 0);
      }
    } else {
      cursor.setTime(cursor.getTime() + remaining * 60000);
      remaining = 0;
    }
  }
  return cursor.toISOString();
}

export function targetMinutesFor(
  baseHours: number,
  priority: string,
  config: SlaConfig
): number {
  const factor = Number(config.priorityFactor[priority] ?? 1);
  return Math.max(15, Math.round((Number(baseHours) || config.defaultHours) * (Number.isFinite(factor) && factor > 0 ? factor : 1) * 60));
}

export function computeDueAt(
  receivedAt: string,
  baseHours: number,
  priority: string,
  config: SlaConfig
): { dueAt: string; targetMinutes: number } {
  const targetMinutes = targetMinutesFor(baseHours, priority, config);
  return { dueAt: addBusinessMinutes(receivedAt, targetMinutes, config), targetMinutes };
}

export function slaState(
  occurrence: {
    received_at: string;
    due_at: string | null;
    status: string;
    sla_paused_at: string | null;
    sla_pause_minutes: number | null;
    sla_target_minutes: number | null;
    closed_at: string | null;
  },
  config: SlaConfig,
  referenceIso = new Date().toISOString()
): SlaState {
  const targetMinutes = Number(occurrence.sla_target_minutes) || config.defaultHours * 60;
  const baseDue = occurrence.due_at ?? computeDueAt(occurrence.received_at, config.defaultHours, 'Normal', config).dueAt;
  const pausedBefore = Number(occurrence.sla_pause_minutes) || 0;
  const activePause = occurrence.sla_paused_at
    ? businessMinutesBetween(occurrence.sla_paused_at, referenceIso, config)
    : 0;
  const dueAt = addBusinessMinutes(baseDue, pausedBefore + activePause, config);
  const elapsed = businessMinutesBetween(occurrence.received_at, referenceIso, config);
  const remainingMinutes = businessMinutesBetween(referenceIso, dueAt, config);
  const progress = targetMinutes > 0 ? Math.min(100, Math.round((elapsed / targetMinutes) * 100)) : 0;

  if (occurrence.sla_paused_at) {
    return { status: 'paused', dueAt, targetMinutes, remainingMinutes, pausedMinutes: pausedBefore + activePause, progress };
  }
  if (occurrence.closed_at) {
    return {
      status: remainingMinutes > 0 || new Date(occurrence.closed_at) <= new Date(dueAt) ? 'met' : 'breached',
      dueAt, targetMinutes, remainingMinutes, pausedMinutes: pausedBefore, progress
    };
  }
  return {
    status: remainingMinutes <= 0 ? 'overdue' : remainingMinutes <= 120 ? 'due_soon' : 'on_track',
    dueAt,
    targetMinutes,
    remainingMinutes,
    pausedMinutes: pausedBefore,
    progress
  };
}
