/**
 * The stored-document shape for a résumé file reference.
 *
 * Two Mongoose schemas embed this exact shape:
 *
 *  1. `candidateProfile.resume` -- the candidate's *current* résumé (FR-029).
 *  2. `application.resumeSnapshot` -- the résumé reference recorded *at apply
 *     time* (FR-056), which must not change when the candidate later replaces
 *     their résumé.
 *
 * The *data* is intentionally duplicated between the two: FR-056 requires the
 * application to remember what was on file when the candidate applied. The
 * *schema definition* is deliberately shared, so the two copies cannot drift
 * apart in shape, field names or validation. Sharing the sub-schema costs one
 * small module and removes an entire class of "live and snapshot disagree"
 * bugs.
 *
 * What is deliberately NOT stored:
 *
 *  - résumé bytes (DC-002, FR-028) -- the file lives in Cloudinary;
 *  - a Cloudinary delivery URL. A URL is a *delivery mechanism*, not an
 *    authorization decision (DC-011): it is temporary, private and issued only
 *    after Hireflow authorizes the request. Baking a URL into the database
 *    would freeze a value that is supposed to be transient.
 *
 * `assetId` is the Cloudinary reference we can later ask for a signed delivery
 * URL with -- in Cloudinary terms, the `public_id`. The exact signing and
 * URL-generation implementation is deliberately not part of this phase
 * (`D-016`).
 */
import { Schema } from 'mongoose';

export const resumeAssetSchema = new Schema(
  {
    /** Cloudinary asset reference (the `public_id`), used to request a delivery URL. */
    assetId: { type: String, required: true, trim: true, maxlength: 255 },
    /** Original client-side filename (FR-029). */
    originalFilename: { type: String, required: true, trim: true, maxlength: 255 },
    /** MIME type claimed at upload; content-based validation is a service concern (FR-027). */
    mimeType: { type: String, required: true, trim: true, maxlength: 100 },
    /** Byte size (FR-029); the upper bound is the Phase 1 validation decision (`OQ-007`). */
    sizeBytes: {
      type: Number,
      required: true,
      min: 1,
      validate: {
        validator: (value: number) => Number.isInteger(value),
        message: 'sizeBytes must be a whole number of bytes',
      },
    },
    /** When the file was stored in Cloudinary (FR-029). */
    uploadedAt: { type: Date, required: true },
  },
  {
    // A résumé reference never needs its own identity: it is always read and
    // written as part of the profile or application that owns it.
    _id: false,
    // The reference is a snapshot; nothing in the MVP updates it in place.
    // Replacements replace the whole subdocument (FR-024).
    versionKey: false,
  },
);
