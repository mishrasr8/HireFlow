/**
 * Domain constants shared by the Phase 3 schemas.
 *
 * These are *persistence* constants: the closed value sets that documents in
 * MongoDB are allowed to hold. They live in the API package because most of
 * them have no HTTP shape yet -- contracts are the HTTP surface, and nothing
 * else in this phase puts these sets on the wire.
 *
 * The one deliberate exception is `CAPABILITIES`: Phase 4 registration puts a
 * capability on the wire, so the wire enum now lives in `@hireflow/contracts`
 * and is *the* source of truth. This file derives the persistence set from it,
 * which is the `D-001`/`DC-001` guarantee stated as a compile-time fact: the
 * database can never store a capability the wire contract does not know about,
 * and vice versa. When a later phase puts another set on the wire (for example
 * employment type on a job form), that set moves into contracts the same way,
 * deliberately, rather than being duplicated ahead of time.
 *
 * Everything here is a *data-domain fact*:
 *
 *  - `CAPABILITIES` is the closed set from `D-001`/`D-013`, echoed from the
 *    wire contract. `DC-001` requires that a third capability (for example
 *    Admin) can be added later without redesigning stored data or
 *    authorization logic -- which is exactly why the set is an enum over an
 *    array of strings rather than a fixed object shape with one boolean per
 *    capability. Adding Admin is adding one value to the enum; it is not a
 *    schema migration and not a rewrite of `FR-097`.
 *  - `APPLICATION_STATUSES` is the controlled status set from `FR-059`/`DC-003`.
 *  - The *terminal* set is a data fact, not transition-map logic: 10.6.1
 *    declares `HIRED`, `REJECTED` and `WITHDRAWN` terminal with no outbound
 *    transitions. That fact is what the Application schema's `active` flag
 *    (and therefore the partial unique index behind `FR-057`) depends on.
 *    The full from/to transition map itself is domain/service logic and is
 *    deliberately *not* implemented in this phase.
 *  - `INVITATION_STATUSES` is the lifecycle from `FR-098`/`D-014`.
 *  - `JOB_STATUSES` is the finalized job lifecycle (`OQ-009`): Draft /
 *    Published / Closed, with no PAUSED state. Adding or renaming a value
 *    later is an enum change.
 *  - `EMPLOYMENT_TYPES` is the finalized employment-type value set. `FR-044`
 *    requires the field but did not enumerate the values; product decision
 *    (recorded in `docs/product-requirements.md` §13.1) confirmed these four.
 *    A closed enum is used because silently accepting an unvalidated string
 *    would defeat `DC-003` (closed sets are schema enums).
 */
import { CAPABILITY_VALUES } from '@hireflow/contracts';

/** The capabilities an account may hold in the MVP (`D-001`, `D-013`). */
export const CAPABILITIES = [...CAPABILITY_VALUES] as const;

/**
 * Application statuses, exactly the eight values of `FR-059`. Closed set:
 * arbitrary strings are rejected (`DC-003`).
 */
export const APPLICATION_STATUSES = [
  'APPLIED',
  'UNDER_REVIEW',
  'SHORTLISTED',
  'INTERVIEW',
  'OFFERED',
  'HIRED',
  'REJECTED',
  'WITHDRAWN',
] as const;

/**
 * Terminal statuses, per the normative map in 10.6.1: no outbound transitions,
 * cannot be reopened (`FR-085`).
 */
export const TERMINAL_APPLICATION_STATUSES = ['HIRED', 'REJECTED', 'WITHDRAWN'] as const;

/** Whether a status is terminal. Pure data fact; no transition logic here. */
export function isTerminalApplicationStatus(status: ApplicationStatus): boolean {
  return (TERMINAL_APPLICATION_STATUSES as readonly string[]).includes(status);
}

/** Whether a status represents an *active* application (`FR-057`). */
export function isActiveApplicationStatus(status: ApplicationStatus): boolean {
  return !isTerminalApplicationStatus(status);
}

/** Invitation lifecycle, exactly the four states of `FR-098`/`D-014`. */
export const INVITATION_STATUSES = ['PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED'] as const;

/** Job lifecycle: the finalized set behind `FR-043`/`FR-046`/`FR-047`/`FR-048` (`OQ-009`). */
export const JOB_STATUSES = ['DRAFT', 'PUBLISHED', 'CLOSED'] as const;

/**
 * Employment-type values. `FR-044` requires the field but did not enumerate
 * the values; this set is the product decision (recorded in
 * `docs/product-requirements.md` §13.1). Extending the set later is a
 * one-value enum change.
 */
export const EMPLOYMENT_TYPES = ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERNSHIP'] as const;

export type Capability = (typeof CAPABILITIES)[number];
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];
export type InvitationStatus = (typeof INVITATION_STATUSES)[number];
export type JobStatus = (typeof JOB_STATUSES)[number];
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];
