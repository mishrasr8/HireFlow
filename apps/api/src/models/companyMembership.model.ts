/**
 * CompanyMembership -- the *only* thing that ties a user to a company.
 *
 * This is the entire answer to `DC-012` / `FR-097` in one collection:
 *
 * ```text
 * User  ── holds ──> capabilities: ['CANDIDATE', 'RECRUITER']   (on User)
 * User  ── has ────> CompanyMembership ──> Company              (here)
 * ```
 *
 * Capability and membership are two different facts, stored in two different
 * collections. "Is this user a recruiter?" is answered from User; "may this
 * user touch *this company's* data?" is answered here. A recruiter with no
 * membership row reaches nothing (`FR-049`, `FR-068`), and holding the
 * capability grants access to no company at all (`DC-012`).
 *
 * ## Exactly one company: enforced by the database
 *
 * The unique index on `userId` makes `FR-037` a database guarantee, not a
 * service-layer promise: a user can physically have at most one membership row,
 * so no code path (and no bug) can make one candidate-turned-recruiter belong
 * to two companies. Accepting a second invitation would fail at the insert
 * instead of corrupting the model.
 *
 * The index is also the backstop for `FR-083`: accepting an invitation whose
 * acceptance logic forgot to pre-check "already a member" is still rejected by
 * the database.
 *
 * ## Extensibility cost, stated honestly (`DC-004`)
 *
 * `DC-004` requires recruiter-to-company to remain extensible to many-to-many.
 * It is: the relationship is already a row, not a `companyId` field on User, so
 * the *shape* needs no migration. The exact price of that future change is
 * dropping this one unique index (plus deciding what happens to existing
 * memberships). That is a small, named, reversible change -- unlike redesigning
 * a denormalized `user.companyId`, which would have been cheap now and
 * expensive later.
 *
 * ## Why no status field
 *
 * Membership has states "present" and "absent", and that is all. "Pending" is
 * not a membership; it is an Invitation that has not been accepted (`D-014`).
 * Duplicating the pending state here would create two truths that can diverge
 * (an invitation accepted but a membership still "pending", or vice versa).
 * `DC-008` asks that the join state be representable as pending / accepted /
 * absent -- it is: pending lives on the invitation, absent is the absence of a
 * row, accepted is the row. One writer owns each fact.
 *
 * `invitationId` is provenance: it records *how* this join happened, which
 * answers "who brought this recruiter in" and supports audit and future
 * "accounts created via invitation X" questions without a permission system.
 */
import { Schema, model, type Model, type Types } from 'mongoose';

export interface CompanyMembershipDoc {
  userId: Types.ObjectId;
  companyId: Types.ObjectId;
  invitationId: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const companyMembershipSchema = new Schema<CompanyMembershipDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true },
    invitationId: { type: Schema.Types.ObjectId, ref: 'Invitation', required: true },
  },
  {
    timestamps: true,
    collection: 'company_memberships',
  },
);

/**
 * At most one membership per user: the database-level spelling of `FR-037`
 * (see the header comment for why this is the right mechanism).
 */
companyMembershipSchema.index({ userId: 1 }, { unique: true });

/**
 * "List this company's recruiters" (companion to the invitations a recruiter
 * issues, and to any future team view). The unique `userId` index cannot serve
 * a company-first query, so a separate index on `companyId` is justified.
 */
companyMembershipSchema.index({ companyId: 1 });

export const CompanyMembership: Model<CompanyMembershipDoc> = model<CompanyMembershipDoc>(
  'CompanyMembership',
  companyMembershipSchema,
);
