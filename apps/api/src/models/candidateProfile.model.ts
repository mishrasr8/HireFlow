/**
 * CandidateProfile -- the candidate-facing professional data.
 *
 * Why a separate collection rather than fields on User, and why a document
 * (not a subdocument of User):
 *
 *  - It is a 1:1 *optional* relationship: an account holding only the Recruiter
 *    capability has no profile (`FR-037`'s converse holds: a profile exists
 *    only for candidates). Embedding an entire profile inside every User would
 *    leave recruiter-only documents carrying an empty, meaningless block.
 *  - Update frequency differs. The User document is read on every
 *    authenticated request and changes rarely; the profile is edited often
 *    (`FR-015`---`FR-019`). Separating them keeps the hot authentication path
 *    small and means profile writes never write a document that another hot
 *    query is reading.
 *  - It draws a privacy boundary that the requirements care about: résumé and
 *    profile data are the most sensitive data in the product (`R-03`), and the
 *    collection boundary makes "which queries touch profile data" answerable.
 *
 * It is a separate *document* (not an array) because the relationship is
 * exactly one-to-one, enforced by the unique index on `userId`.
 *
 * ## Where is the name?
 *
 * `FR-016` says the profile captures a name. We store the name on the User
 * record only. A person has one name regardless of capability, and the name is
 * needed by the User for recruiter-facing views too. Two fields named `name`
 * (one per collection) would be two sources of truth that can drift. The
 * profile *view* reads `user.name`; duplication is rejected in favour of a
 * single source of truth. Documented tradeoff; see `docs/database-design.md`.
 *
 * ## Editing model
 *
 * The embedded arrays (`experience`, `education`, `skills`) are edited
 * element-wise by the profile service in a later phase. They are embedded
 * because they are never queried independently of the profile and always
 * returned with it. The requirements do not bound their length, so no
 * arbitrary cap is invented here; unbounded-growth risk is noted in
 * `docs/database-design.md` and can be addressed with a cap the developer
 * explicitly chooses.
 */
import { Schema, model, type Model, type Types } from 'mongoose';

import { resumeAssetSchema } from './resumeAsset.js';

export interface ExperienceEntry {
  role: string;
  organisation: string;
  startDate: Date;
  endDate: Date | null;
  description?: string;
}

export interface EducationEntry {
  institution: string;
  qualification: string;
  startDate: Date;
  endDate: Date | null;
}

const experienceSchema = new Schema<ExperienceEntry>(
  {
    role: { type: String, required: true, trim: true, minlength: 1, maxlength: 120 },
    organisation: { type: String, required: true, trim: true, minlength: 1, maxlength: 120 },
    startDate: { type: Date, required: true },
    // null (not a date) means "current position"; the service sets the value,
    // never a sentinel date far in the future.
    endDate: { type: Date, default: null },
    description: { type: String, trim: true, maxlength: 2000 },
  },
  { _id: false },
);

const educationSchema = new Schema<EducationEntry>(
  {
    institution: { type: String, required: true, trim: true, minlength: 1, maxlength: 120 },
    qualification: { type: String, required: true, trim: true, minlength: 1, maxlength: 120 },
    startDate: { type: Date, required: true },
    endDate: { type: Date, default: null },
  },
  { _id: false },
);

export interface CandidateProfileDoc {
  userId: Types.ObjectId;
  headline?: string;
  location?: string;
  summary?: string;
  skills: string[];
  experience: ExperienceEntry[];
  education: EducationEntry[];
  resume: {
    assetId: string;
    originalFilename: string;
    mimeType: string;
    sizeBytes: number;
    uploadedAt: Date;
  } | null;
  createdAt: Date;
  updatedAt: Date;
}

const candidateProfileSchema = new Schema<CandidateProfileDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    headline: { type: String, trim: true, maxlength: 200 },
    location: { type: String, trim: true, maxlength: 100 },
    summary: { type: String, trim: true, maxlength: 5000 },
    skills: [{ type: String, trim: true, maxlength: 50 }],
    experience: {
      type: [experienceSchema],
      default: [],
      validate: {
        // FR-018: dates are validated. An entry cannot end before it starts;
        // a null endDate is a running entry and skips the check.
        validator: (value: ExperienceEntry[]) =>
          value.every(
            (entry) =>
              entry.endDate === null || entry.endDate.getTime() >= entry.startDate.getTime(),
          ),
        message: 'experience endDate must be on or after startDate',
      },
    },
    education: {
      type: [educationSchema],
      default: [],
      validate: {
        validator: (value: EducationEntry[]) =>
          value.every(
            (entry) =>
              entry.endDate === null || entry.endDate.getTime() >= entry.startDate.getTime(),
          ),
        message: 'education endDate must be on or after startDate',
      },
    },
    // null means "no current résumé"; setting the path to a fresh resumeAsset
    // replaces the current one (FR-024), setting it to null deletes the
    // reference (FR-030). The model never stores résumé bytes (DC-002).
    resume: { type: resumeAssetSchema, default: null },
  },
  {
    timestamps: true,
    collection: 'candidate_profiles',
  },
);

/**
 * One profile per candidate, enforced by the database. `userId` is the only
 * lookup key for a profile (`FR-015` and the apply flow both arrive by user),
 * so this index also serves the read.
 */
candidateProfileSchema.index({ userId: 1 }, { unique: true });

export const CandidateProfile: Model<CandidateProfileDoc> = model<CandidateProfileDoc>(
  'CandidateProfile',
  candidateProfileSchema,
);
