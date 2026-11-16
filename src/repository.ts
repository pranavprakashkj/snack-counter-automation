/**
 * In-memory refill store standing in for a database table.
 *
 * Callers always get copies, so two requests handled at the same time each
 * work on their own snapshot, as they would against a real database. Two
 * operations enforce the core invariants:
 *   - addIfNoneActive: at most one open refill per office (a partial unique
 *     index on office_id where the state is active);
 *   - save: optimistic locking (UPDATE ... WHERE id = ? AND version = ?), so
 *     a write based on a stale read is refused instead of overwriting.
 */

import { ACTIVE_STATES, type Refill } from "./domain.ts";

export class ConcurrentModification extends Error {
  name = "ConcurrentModification";
}

function copy(r: Refill): Refill {
  const d = (x: Date | null) => (x ? new Date(x) : null);
  return {
    ...r,
    reportedAt: new Date(r.reportedAt),
    offerExpiresAt: d(r.offerExpiresAt),
    openCallRetryAt: d(r.openCallRetryAt),
    committedAt: d(r.committedAt),
    purchaseDueAt: d(r.purchaseDueAt),
    purchasedAt: d(r.purchasedAt),
    claimRetryAt: d(r.claimRetryAt),
    claimSubmittedAt: d(r.claimSubmittedAt),
    lastHrReminderAt: d(r.lastHrReminderAt),
    resolvedAt: d(r.resolvedAt),
    passedOver: [...r.passedOver],
    items: [...r.items],
    history: r.history.map((h) => ({ ...h })),
  };
}

export class InMemoryRefillRepository {
  private readonly rows = new Map<string, Refill>();

  async get(id: string): Promise<Refill> {
    const row = this.rows.get(id);
    if (!row) throw new Error(`no refill ${id}`);
    return copy(row);
  }

  async all(): Promise<Refill[]> {
    return [...this.rows.values()].map(copy);
  }

  /** Inserts the refill unless the office already has an active one; returns whichever is active. */
  async addIfNoneActive(refill: Refill): Promise<{ refill: Refill; created: boolean }> {
    for (const row of this.rows.values()) {
      if (row.officeId === refill.officeId && ACTIVE_STATES.has(row.state)) {
        return { refill: copy(row), created: false };
      }
    }
    this.rows.set(refill.id, copy(refill));
    return { refill: copy(refill), created: true };
  }

  async save(refill: Refill): Promise<Refill> {
    const current = this.rows.get(refill.id);
    if (!current) throw new Error(`no refill ${refill.id}`);
    if (current.version !== refill.version) {
      throw new ConcurrentModification(`refill ${refill.id} changed since it was read`);
    }
    const next = copy({ ...refill, version: refill.version + 1 });
    this.rows.set(refill.id, next);
    return copy(next);
  }
}
