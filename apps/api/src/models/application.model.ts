/**
 * Application -- a candidate's application to a job.
 *
 * This collection carries the most intricate rules in the product, so each one
 * is called out against the requirement that states it.
 *
 * ## Company scoping lives in the query (`DC-005`)
 *
 * `companyId` is stored on the application (denormalized from job → company)
 * so every recruiter query can be scoped *inside* MongoDB
 * (`{ companyId, status }`) instead of fetching first and filtering in memory
 * (`NFR-S-014`). The cost is one extra field set at creation; the benefit is
 * that "recruiter cannot see another company's applicants" (`FR-068`) is
 * structurally true of every future query that uses the index. The denormalized
 * value is not independently editable state: it is written once with the
 * application and never changed.
 *
 * ## Résumé snapshot (`FR-056`)
 *
 * `resumeSnapshot` records the résumé *reference* that was current at apply
 * time (same shape as `CandidateProfile.resume`, shared sub-schema). Replacing
 * a résumé later must not rewrite history. Bytes are never stored (`DC-002`).
 * Whether the *profile* (beyond the résumé) must also be snapshotted at apply
 * time is a reading of `FR-056` left open in `docs/database-design.md`.
 *
 * ## Concurrency: compare-and-set on status, not a version counter
 *
 * `FR-087` (and `NFR-R-008`) require a status change to be rejected when the
 * application's current status is no longer the one the change was based on.
 * The mechanism is the conditional update itself:
 *
 * ```ts
 * findOneAndUpdate(
 *   { _id, status: 'APPLIED' },            // compare
 *   { $set: { status: 'UNDER_REVIEW' }, ... }, // set
 * )
 * ```
 *
 * Two recruiters who both read `APPLIED` cannot both win: the loser's filter
 * fails on the first winner's write and is told to reload. Because every
 * transition changes `status` and nothing else is mutated after creation, the
 * status *is* the version token, and a separate numeric version field would be
 * a second mechanism guarding the same invariant -- confusing, not stronger.
 * `versionKey: false` disables Mongoose's `__v` for the same reason: two
 * concurrency mechanisms would make it impossible to say which one is
 * authoritative. The documented contract that makes this safe: **all** status
 * changes go through the CAS update, never through `doc.save()` on a fetched
 * document. This is write-path discipline, stated in the model and enforced by
 * tests, not by the database.
 *
 * ## `active`: one denormalized boolean with a specific, index-shaped reason
 *
 * `FR-057` requires at most one *active* application per candidate and job.
 * MongoDB can express that as a **partial unique index**, but
 * `partialFilterExpression` supports only a small operator set (equality,
 * `$exists`, comparisons, `$type`, `$and`/`$or`/`$nor`) -- it does *not*
 * support `$in`. So `{ candidateUserId, jobId }` unique *where
 * `status: { $in: [non-terminal...] }`* is impossible directly. The boolean
 * `active` exists to make the partial filter an equality test:
 *
 * ```ts
 * { candidateUserId, jobId }, unique, partialFilterExpression: { active: true }
 * ```
 *
 * `active` is derived (`active = status is non-terminal`) and kept consistent
 * by the same conditional update that changes `status`; a `pre('validate')`
 * hook guards the `save()` path too. Drift is possible only via a non-CAS
 * write, which the model contract forbids. This is the "partial/compound
 * unique index required to express an application rule" called out by the
 * Phase 3 brief.
 *
 * Note that the partial index *permits* a re-application after a terminal
 * status: a `WITHDRAWN`/`REJECTED`/`HIRED` row has `active: false` and does
 * not collide. Whether re-application is allowed is `OQ-024` (answering it is
 * a service-layer decision); the schema supports either answer.
 *
 * ## Status history is embedded, not a collection
 *
 * See `docs/database-design.md` section 8 for the full argument. In brief:
 * the longest legal path is 5 transitions so the history is inherently bounded
 * at 6 entries (10.6.1); embedding makes the status change and its history
 * entry a single atomic document write (`NFR-R-003`); the history is always
 * read with the application (`FR-065`); and it is never queried independently.
 * Immutability of existing entries is write-path discipline (documented) plus
 * the schema-level chain checks below -- MongoDB cannot be asked to freeze an
 * array, so a chain validator catches corruption instead of denying it.
 */
import { Schema, model, type Model, type Types } from 'mongoose';

import {
  APPLICATION_STATUSES,
  isActiveApplicationStatus,
  type ApplicationStatus,
} from './constants.js';
import { resumeAssetSchema } from './resumeAsset.js';

const MAX_HISTORY_ENTRIES = 6; // creation + the 5 transitions of the longest legal path

export interface StatusHistoryEntry {
  previousStatus: ApplicationStatus | null;
  status: ApplicationStatus;
  changedByUserId: Types.ObjectId;
  changedAt: Date;
}

export interface ResumeSnapshot {
  assetId: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: Date;
}

export interface ApplicationDoc {
  candidateUserId: Types.ObjectId;
  jobId: Types.ObjectId;
  companyId: Types.ObjectId;
  status: ApplicationStatus;
  active: boolean;
  resumeSnapshot: ResumeSnapshot;
  statusHistory: StatusHistoryEntry[];
  createdAt: Date;
  updatedAt: Date;
}

const statusHistoryEntrySchema = new Schema<StatusHistoryEntry>(
  {
    // null only on the creation entry (the application "came from nowhere").
    previousStatus: { type: String, enum: [...APPLICATION_STATUSES, null], default: null },
    status: { type: String, enum: [...APPLICATION_STATUSES], required: true },
    changedByUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    changedAt: { type: Date, required: true },
  },
  { _id: false },
);

/**
 * The history is a chain: entry 0 has `previousStatus: null`, and each later
 * entry's `previousStatus` must equal the previous entry's `status`. A broken
 * chain means a corrupted write. Also validates that the array is bounded at
 * the longest legal path (10.6.1) and non-empty (an application always has its
 * creation entry, `FR-058`).
 */
export function validStatusHistoryChain(entries: StatusHistoryEntry[]): boolean {
  if (entries.length === 0 || entries.length > MAX_HISTORY_ENTRIES) {
    return false;
  }
  const [first, ...rest] = entries;
  if (first === undefined || first.previousStatus !== null) {
    return false;
  }
  let previous: StatusHistoryEntry = first;
  for (const entry of rest) {
    if (entry.previousStatus !== previous.status) {
      return false;
    }
    previous = entry;
  }
  return true;
}

const applicationSchema = new Schema<ApplicationDoc>(
  {
    candidateUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    jobId: { type: Schema.Types.ObjectId, ref: 'Job', required: true },
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true },
    status: {
      type: String,
      enum: [...APPLICATION_STATUSES],
      default: 'APPLIED',
      required: true,
    },
    // Derived from status; consistency is guarded below and by the CAS write
    // path. Optional=false forces every writer to state it.
    active: { type: Boolean, required: true },
    resumeSnapshot: { type: resumeAssetSchema, required: true },
    statusHistory: {
      type: [statusHistoryEntrySchema],
      required: true,
      validate: {
        validator: validStatusHistoryChain,
        message: `statusHistory must be a non-empty chain of at most ${MAX_HISTORY_ENTRIES} entries`,
      },
    },
  },
  {
    timestamps: true,
    // concurrency is compare-and-set on status; see the header comment.
    versionKey: false,
    collection: 'applications',
  },
);

/** `active` must equal "status is non-terminal". Pure, so it is directly testable. */
export function activeMatchesStatus(active: boolean, status: ApplicationStatus): boolean {
  return active === isActiveApplicationStatus(status);
}

applicationSchema.pre<ApplicationDoc>('validate', function (next) {
  const isKnownStatus = (APPLICATION_STATUSES as readonly string[]).includes(this.status);
  if (!isKnownStatus) {
    // A bad status value is reported by the enum path validator; derived-state
    // checks are meaningless until the status itself is a known value, so the
    // hook stays out of that error's way.
    next();
    return;
  }
  if (!activeMatchesStatus(this.active, this.status)) {
    next(new Error('active must reflect whether the status is terminal'));
    return;
  }
  if (this.statusHistory.length > 0) {
    const lastEntry = this.statusHistory[this.statusHistory.length - 1];
    if (lastEntry !== undefined && lastEntry.status !== this.status) {
      next(new Error('the last statusHistory entry must match the current status'));
      return;
    }
  }
  next();
});

/**
 * FR-057 at the database level: at most one *active* application per
 * candidate/job pair, even under concurrent requests. The partial filter is an
 * equality on `active` because `partialFilterExpression` cannot express
 * `$in`. Re-application after a terminal status is *not* blocked here by
 * design (`OQ-024`; the old row is inactive and does not collide).
 */
applicationSchema.index(
  { candidateUserId: 1, jobId: 1 },
  { unique: true, partialFilterExpression: { active: true } },
);

/** "My applications" (`FR-065`), newest first. */
applicationSchema.index({ candidateUserId: 1, createdAt: -1 });

/** "Applicants for a job, filterable by status" (`FR-066`). */
applicationSchema.index({ jobId: 1, status: 1 });

/**
 * Company-scoped views (`FR-069` counts per status; `DC-005` scopes *every*
 * recruiter application query inside the database). `companyId` is
 * denormalized on purpose; see the header comment.
 */
applicationSchema.index({ companyId: 1, status: 1 });

export const Application: Model<ApplicationDoc> = model<ApplicationDoc>(
  'Application',
  applicationSchema,
);
