/**
 * Job -- a company's job posting.
 *
 * Ownership is direct: `companyId` is the owning company (the job is *of* the
 * company, not of a recruiter). The recruiter who created it is recorded as
 * `createdByUserId` for provenance only -- 10.6.1 and `FR-062` are explicit
 * that the creator has no special permission over the job; every member of the
 * owning company may act on it. Provenance must not look like a permission, so
 * the field is named and documented as such.
 *
 * ## Draft vs publish completeness
 *
 * `FR-043` allows creating a job as a draft, and `FR-051` forbids publishing
 * unless the minimum required fields are present and valid. The two together
 * mean the schema must allow drafting, so the *schema* requires the fields
 * every sane job has (title, description, location, employment type) and the
 * *publish gate* in a later phase decides which additional fields are the
 * "minimum" for publication. Inventing that minimum set here would be guessing
 * `FR-051`'s meaning.
 *
 * `responsibilities`, `requirements` and `skills` are captured arrays that may
 * start empty; "an empty list is invalid" is a product rule, not a storage
 * rule.
 *
 * ## Status and the timestamps around it
 *
 * `status` follows `DRAFT` → `PUBLISHED` ↔ `CLOSED` (the finalized set,
 * `OQ-009` resolved; no PAUSED state). `publishedAt` and `closedAt` are
 * recorded by the job service
 * when those transitions happen; the schema does not auto-derive them because
 * an edit that touches the document must not silently corrupt the times.
 *
 * ## Salary
 *
 * `salaryRange` is optional (`OQ-008`). `min`/`max`/`currency` are optional
 * because a range can be open-ended; the max>=min ordering is validated at the
 * schema.
 */

import { Schema, model, type Model, type Types } from 'mongoose';

import {
  EMPLOYMENT_TYPES,
  JOB_STATUSES,
  type EmploymentType,
  type JobStatus,
} from './constants.js';

export interface SalaryRange {
  min?: number;
  max?: number;
  currency?: string;
}

export interface JobDoc {
  companyId: Types.ObjectId;
  createdByUserId: Types.ObjectId;
  title: string;
  description: string;
  responsibilities: string[];
  requirements: string[];
  location: string;
  employmentType: EmploymentType;
  salaryRange: SalaryRange | null;
  skills: string[];
  status: JobStatus;
  publishedAt: Date | null;
  closedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const salaryRangeSchema = new Schema<SalaryRange>(
  {
    min: { type: Number, min: 0 },
    max: { type: Number, min: 0 },
    // ISO 4217 code (e.g. "USD"); format validation belongs to input
    // validation, not persistence.
    currency: { type: String, trim: true, maxlength: 3 },
  },
  { _id: false },
);

const jobSchema = new Schema<JobDoc>(
  {
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true },
    createdByUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, trim: true, minlength: 1, maxlength: 120 },
    description: { type: String, required: true, trim: true, minlength: 1, maxlength: 20_000 },
    responsibilities: [{ type: String, required: true, trim: true, maxlength: 2000 }],
    requirements: [{ type: String, required: true, trim: true, maxlength: 2000 }],
    location: { type: String, required: true, trim: true, minlength: 1, maxlength: 120 },
    employmentType: { type: String, enum: [...EMPLOYMENT_TYPES], required: true },
    // null means "no salary posted" (OQ-008).
    salaryRange: { type: salaryRangeSchema, default: null },
    skills: [{ type: String, trim: true, maxlength: 50 }],
    status: { type: String, enum: [...JOB_STATUSES], default: 'DRAFT', required: true },
    publishedAt: { type: Date, default: null },
    closedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    collection: 'jobs',
  },
);

jobSchema.path('salaryRange').validate({
  validator: (value: SalaryRange | null) => {
    if (value === null || value.min === undefined || value.max === undefined) {
      return true;
    }
    return value.max >= value.min;
  },
  message: 'salaryRange max must be greater than or equal to min',
});

/**
 * The MVP browse query (`FR-075`): published jobs, newest first, bounded by
 * `FR-076`/`NFR-P-010`. A compound index matching filter + sort in one scan;
 * `publishedAt` descending because the newest-first sort is the whole point of
 * the query. Drafts and closed jobs never appear (`FR-052`), so leading with
 * `status` keeps the index selective.
 */
jobSchema.index({ status: 1, publishedAt: -1 });

/**
 * Recruiter views (`FR-053`: own company's jobs with status) and the company
 * profile's published-job list (`FR-050`). A company-first filter cannot use
 * the browse index, so this compound index is justified independently.
 */
jobSchema.index({ companyId: 1, status: 1 });

/**
 * V1 note: full-text search over title/description/company (`FR-101`) will need
 * its own text index or Atlas Search, and company-name search (`FR-102`) a
 * collation or a company lookup. Deliberately not present in the MVP; see
 * `docs/database-design.md`.
 */

export const Job: Model<JobDoc> = model<JobDoc>('Job', jobSchema);
