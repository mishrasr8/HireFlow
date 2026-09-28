/**
 * Company -- a hiring organisation.
 *
 * The first recruiter creates a company and becomes its first member
 * (`FR-038`); subsequent members join only by accepting an invitation
 * (`FR-041`). The "who founded it" fact is recorded by the membership row, so
 * the company document itself does not carry a founder reference -- provenance
 * lives where the relationship lives.
 *
 * ## Why `invitationSettings` is required and has no default
 *
 * `FR-098`/`D-014` make invitation expiry and the maximum number of pending
 * invitations **company-configurable**, and §13.3 explicitly says the numeric
 * bounds are deliberately **not** decided here. The schema therefore demands
 * both values on every company document but imposes *no* numeric bounds:
 *
 *  - a positive integer check is data integrity (an expiry of 0 or a limit of
 *    -5 is malformed under any product policy);
 *  - the product *bounds* (minimum and maximum acceptable values) are the
 *    Phase 1 validation decision and belong to the service layer, not the
 *    schema. Hard-coding `min: 24, max: 168` here would present a guess as a
 *    decision, which is exactly what §13.3 warns against.
 *
 * So a Company cannot be created without deciding *a* value for each setting,
 * and the numbers the caller chose are stored, per-company, and snapshot onto
 * each invitation at creation (see `invitation.model.ts`).
 *
 * ## No uniqueness on the company name
 *
 * `OQ-016` was downgraded to non-blocking: with invite-based joining nobody
 * ever types or searches a company name to join, so a duplicate name is a
 * cosmetic problem, not a correctness one. A unique index was deliberately not
 * added; a soft "this name is already in use" warning is sufficient and can
 * live in the registration service.
 */
import { Schema, model, type Model } from 'mongoose';

export interface InvitationSettings {
  expiryHours: number;
  maxPendingInvitations: number;
}

export interface CompanyDoc {
  name: string;
  industry?: string;
  location?: string;
  website?: string;
  description?: string;
  invitationSettings: InvitationSettings;
  createdAt: Date;
  updatedAt: Date;
}

const invitationSettingsSchema = new Schema<InvitationSettings>(
  {
    expiryHours: {
      type: Number,
      required: true,
      validate: {
        // Data-integrity only; the *bounds* are the Phase 1 validation decision.
        validator: (value: number) => Number.isInteger(value) && value > 0,
        message: 'expiryHours must be a positive whole number',
      },
    },
    maxPendingInvitations: {
      type: Number,
      required: true,
      validate: {
        validator: (value: number) => Number.isInteger(value) && value > 0,
        message: 'maxPendingInvitations must be a positive whole number',
      },
    },
  },
  { _id: false },
);

const companySchema = new Schema<CompanyDoc>(
  {
    name: { type: String, required: true, trim: true, minlength: 1, maxlength: 120 },
    industry: { type: String, trim: true, maxlength: 80 },
    // Free text for now; URL-format validation belongs to the registration
    // service in a later phase, not to the persistence layer.
    website: { type: String, trim: true, maxlength: 250 },
    location: { type: String, trim: true, maxlength: 100 },
    description: { type: String, trim: true, maxlength: 5000 },
    invitationSettings: { type: invitationSettingsSchema, required: true },
  },
  {
    timestamps: true,
    collection: 'companies',
  },
);

export const Company: Model<CompanyDoc> = model<CompanyDoc>('Company', companySchema);
