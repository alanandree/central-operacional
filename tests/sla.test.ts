import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = path.join(os.tmpdir(), `co-sla-tests-${Date.now()}`);

const sla = await import('../server/sla.ts');

const config: sla.SlaConfig = {
  hours: { start: '08:00', end: '18:00', days: [1, 2, 3, 4, 5] },
  holidays: ['2026-11-30'],
  priorityFactor: { Baixa: 1.5, Normal: 1, Alta: 0.5, Urgente: 0.25 },
  pauseStatuses: ['Aguardando cliente', 'Aguardando transportadora', 'Aguardando motorista'],
  defaultHours: 48
};

function iso(year: number, month: number, day: number, hour: number, minute: number): string {
  return new Date(year, month - 1, day, hour, minute).toISOString();
}

test('SLA usa apenas minutos úteis restantes e continua no próximo dia útil', () => {
  const result = sla.addBusinessMinutes(iso(2026, 11, 27, 17, 30), 60, config);
  assert.equal(result, iso(2026, 12, 1, 8, 30));
});

test('SLA ignora fins de semana', () => {
  const result = sla.addBusinessMinutes(iso(2026, 11, 28, 10, 0), 60, config);
  assert.equal(result, iso(2026, 12, 1, 9, 0));
});

test('SLA ignora feriados configurados', () => {
  const result = sla.addBusinessMinutes(iso(2026, 11, 27, 17, 45), 30, config);
  assert.equal(result, iso(2026, 12, 1, 8, 15));
});

test('SLA aplica fator por prioridade', () => {
  const normal = sla.targetMinutesFor(48, 'Normal', config);
  const urgente = sla.targetMinutesFor(48, 'Urgente', config);
  assert.equal(normal, 2880);
  assert.equal(urgente, 720);
});

test('SLA pausa e retoma o prazo', () => {
  const receivedAt = iso(2026, 11, 27, 16, 0);
  const base = sla.computeDueAt(receivedAt, 4, 'Normal', config);
  assert.equal(base.dueAt, iso(2026, 12, 1, 10, 0));
  const state = sla.slaState(
    {
      received_at: receivedAt,
      due_at: base.dueAt,
      status: 'Aguardando cliente',
      sla_paused_at: iso(2026, 12, 1, 9, 0),
      sla_pause_minutes: 0,
      sla_target_minutes: base.targetMinutes,
      closed_at: null
    },
    config,
    iso(2026, 12, 1, 10, 0)
  );
  assert.equal(state.status, 'paused');
  assert.equal(state.dueAt, iso(2026, 12, 1, 11, 0));
  assert.equal(state.pausedMinutes, 60);
});
