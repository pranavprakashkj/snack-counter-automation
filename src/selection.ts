/**
 * Choosing who buys.
 *
 * Only volunteers physically at that office today are asked; a visitor from
 * the other office counts as present where they are. Among those, rank by:
 *   1. not currently out of pocket, so nobody fronts money again while still
 *      waiting on HR;
 *   2. fewest refills in the last 90 days, so the load spreads out;
 *   3. longest since their last refill;
 *   4. volunteer ID, so the choice is deterministic.
 */

import { OUTSTANDING_STATES, SPENT_STATES, type Office, type Refill, type Volunteer } from "./domain.ts";

export const FAIRNESS_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

export interface Load {
  outstanding: number;        // refills paid for and not yet reimbursed
  recentRefills: number;
  lastRefillAt: Date | null;
}

export function loadOf(volunteerId: string, refills: readonly Refill[], now: Date): Load {
  const mine = refills.filter((r) => r.buyerId === volunteerId && SPENT_STATES.has(r.state));
  const times = mine.map((r) => r.purchasedAt!.getTime());
  return {
    outstanding: mine.filter((r) => OUTSTANDING_STATES.has(r.state)).length,
    recentRefills: times.filter((t) => now.getTime() - t <= FAIRNESS_WINDOW_MS).length,
    lastRefillAt: times.length ? new Date(Math.max(...times)) : null,
  };
}

/**
 * @param locationToday office ID the volunteer is at today, or null (remote, holiday, sick)
 * @param exclude volunteers who already passed on this refill
 */
export function chooseBuyer(
  office: Office,
  volunteers: readonly Volunteer[],
  refills: readonly Refill[],
  locationToday: (volunteerId: string) => string | null,
  now: Date,
  exclude: ReadonlySet<string> = new Set(),
): Volunteer | null {
  const busy = new Set(refills.filter((r) => r.state === "committed").map((r) => r.buyerId));
  const candidates = volunteers.filter(
    (v) => v.active && !exclude.has(v.id) && !busy.has(v.id) && locationToday(v.id) === office.id,
  );
  if (candidates.length === 0) return null;

  const rank = (v: Volunteer): [number, number, number, string] => {
    const load = loadOf(v.id, refills, now);
    return [load.outstanding > 0 ? 1 : 0, load.recentRefills, load.lastRefillAt?.getTime() ?? -Infinity, v.id];
  };
  const byRank = (a: Volunteer, b: Volunteer): number => {
    const [ra, rb] = [rank(a), rank(b)];
    for (let i = 0; i < 3; i++) if (ra[i] !== rb[i]) return (ra[i] as number) - (rb[i] as number);
    return ra[3] < rb[3] ? -1 : ra[3] > rb[3] ? 1 : 0;
  };
  return [...candidates].sort(byRank)[0];
}
