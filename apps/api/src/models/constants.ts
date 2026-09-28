/**
 * Domain constants shared by the Phase 3 schemas.
 *
 * These are *persistence* constants: the closed value sets that documents in
 * MongoDB are allowed to hold. They live in the API package (not in
 * `@hireflow/contracts`) because nothing in this phase puts them on the wire --
 * contracts are the HTTP surface, and these sets have no HTTP shape yet. When a
 * later phase builds the application API, the values that actually travel over
 * the wire move into (or are echoed by) the contracts package deliberately;
 * they are not duplicated there ahead of that.
 *
 * Everything here is a *data-domain fact*:
 *
 *  - `CAPABILITIES` is the closed set from `D-001`/`D-013`. `DC-001` requires
 *    that a third capability (for example Admin) can be added later without
 *    redesigning stored data or authorization logic -- which is exactly why the
 *    set is an enum over an array of strings rather than a fixed object shape
 *    with one boolean per capability. Adding Admin is adding one value to the
 *    enum; it is not a schema migration and not a rewrite of `FR-097`.
 *  - `APPLICATION_STATUSES` is the controlled status set from `FR-059`/`DC-003`.
 *  - The *terminal* set is a data fact, not transition-map logic: 10.6.1
 *    declares `HIRED`, `REJECTED` and `WITHDRAWN` terminal with no outbound
 *    transitions. That fact is what the Application schema's `active` flag
 *    (and therefore the partial unique index behind `FR-057`) depends on.
 *    The full from/to transition map itself is domain/service logic and is
 *    deliberately *not* implemented in this phase.
 *  - `INVITATION_STATUSES` is the lifecycle from `FR-098`/`D-014`.
 *  - `JOB_STATUSES` is the assumed Draft / Published / Closed set; `OQ-009`
 *    remains open. Adding or renaming a value later is an enum change.
 *  - `EMPLOYMENT_TYPES` is a *provisional* value set: `FR-044` requires an
 *    employment type but does not enumerate the values, so this phase defines
 *    the obvious set and flags it for product confirmation (see
 *    `docs/database-design.md`). The choice is visible, testable and cheap to
 *    change; silently leaving the field an unvalidated string would not be.
 */

/** The capabilities an account may hold in the MVP (`D-001`, `D-013`). */
export const CAPABILITIES = ['CANDIDATE', 'RECRUITER'] as const;

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

/** Job lifecycle: the assumed set behind `FR-043`/`FR-046`/`FR-047`/`FR-048` (`OQ-009`). */
export const JOB_STATUSES = ['DRAFT', 'PUBLISHED', 'CLOSED'] as const;

/**
 * Provisional employment-type values. `FR-044` requires the field but does not
 * enumerate it. Flagged in `docs/database-design.md` as needing product
 * confirmation before Phase 4; the set is deliberately easy to change.
 */
export const EMPLOYMENT_TYPES = ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERNSHIP'] as const;

export type Capability = (typeof CAPABILITIES)[number];
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];
export type InvitationStatus = (typeof INVITATION_STATUSES)[number];
export type JobStatus = (typeof JOB_STATUSES)[number];
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];
