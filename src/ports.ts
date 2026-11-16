/** Boundaries to the outside world. Tests and the demo use the fakes in fakes.ts. */

import type { Money } from "./money.ts";

export interface Clock {
  now(): Date;
}

/** The company chat tool. In production, offer messages carry Accept / Decline buttons that call the service. */
export interface Chat {
  sendDirect(userId: string, text: string): Promise<void>;
  postToChannel(officeId: string, text: string): Promise<void>;
}

/** Who is where on a given local day: an office ID, or null for remote / holiday / sick. */
export interface Calendar {
  locationOn(volunteerId: string, day: string): Promise<string | null>;
}

export interface ClaimRequest {
  employeeId: string;
  amount: Money;          // in the receipt's currency; HR pays out in the employee's payroll currency
  description: string;
  receiptImage: Uint8Array;
}

export type ClaimStatus = "pending" | "approved" | "rejected";

/** The external HR system, run by another company. */
export interface HrSystem {
  createClaim(request: ClaimRequest): Promise<string>;
  getClaimStatus(claimId: string): Promise<ClaimStatus>;
}
