// Shared provider health for model failover. The existing receipt claim serializes admission;
// settings retain the open circuit and the single recovery probe across workers and restarts.
import { randomUUID } from "node:crypto";
import { sql, type Db } from "../db.ts";
import { ProviderRejectedError } from "./receipts.ts";

const FAILURE_WINDOW_MS = 5 * 60_000;
const OPEN_MS = 5 * 60_000;
const FAILURE_LIMIT = 10;
const keyOf = (service: string) => `model.circuit.${service}`;

export type ModelCircuit = {
  failures: number;
  firstFailureAt: number;
  openUntil: number;
  probe: string | null;
  probeUntil: number;
};
const closed = (): ModelCircuit => ({ failures: 0, firstFailureAt: 0, openUntil: 0, probe: null, probeUntil: 0 });
export interface CircuitPermit { probe: string | null }

export class CircuitOpenError extends ProviderRejectedError {
  constructor(service: string) { super(`${service} temporarily paused after repeated transport failures`, 503, true); }
}

/** Called inside paidRequest's service lock, before recording a paid attempt. */
export async function enterModelCircuit(tx: Db, service: string, timeoutMs: number): Promise<CircuitPermit> {
  const key = keyOf(service);
  await tx`INSERT INTO settings (key, value, updated_by) VALUES (${key}, ${tx.json(closed())}, 'model.circuit') ON CONFLICT DO NOTHING`;
  const [row] = await tx<{ value: ModelCircuit }[]>`SELECT value FROM settings WHERE key = ${key} FOR UPDATE`;
  const state = row!.value;
  if (!state.openUntil) return { probe: null };
  const now = Date.now();
  if (state.openUntil > now || state.probeUntil > now) throw new CircuitOpenError(service);
  state.probe = randomUUID();
  state.probeUntil = now + timeoutMs;
  await tx`UPDATE settings SET value = ${tx.json(state)}, updated_at = now() WHERE key = ${key}`;
  return { probe: state.probe };
}

/** Only actual HTTP attempts report health. Cached answers and local refusals cannot restore it. */
export async function recordModelHealth(service: string, permit: CircuitPermit, unavailable: boolean): Promise<void> {
  await sql.begin(async tx => {
    const key = keyOf(service);
    const [row] = await tx<{ value: ModelCircuit }[]>`SELECT value FROM settings WHERE key = ${key} FOR UPDATE`;
    const state = row!.value;
    // A call admitted before opening, or a probe whose lease was replaced, cannot close the circuit.
    if (state.openUntil && (!permit.probe || state.probe !== permit.probe)) return;
    if (!state.openUntil && permit.probe) return;
    if (!unavailable) {
      if (state.failures || state.openUntil) await tx`UPDATE settings SET value = ${tx.json(closed())}, updated_at = now() WHERE key = ${key}`;
      return;
    }
    const now = Date.now();
    if (!state.firstFailureAt || now - state.firstFailureAt > FAILURE_WINDOW_MS) {
      state.firstFailureAt = now;
      state.failures = 0;
    }
    state.failures++;
    if (permit.probe || state.failures >= FAILURE_LIMIT) state.openUntil = now + OPEN_MS;
    state.probe = null;
    state.probeUntil = 0;
    await tx`UPDATE settings SET value = ${tx.json(state)}, updated_at = now() WHERE key = ${key}`;
  });
}

export async function modelCircuits(): Promise<Record<string, ModelCircuit>> {
  const rows = await sql<{ key: string; value: ModelCircuit }[]>`SELECT key, value FROM settings WHERE key LIKE 'model.circuit.%'`;
  return Object.fromEntries(rows.map(row => [row.key.slice("model.circuit.".length), row.value]));
}
