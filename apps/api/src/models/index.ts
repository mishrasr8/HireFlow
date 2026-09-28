/**
 * Model barrel -- the single place that registers every Phase 3 collection.
 *
 * Importing this module is what makes Mongoose aware of the schemas. The API
 * server imports it at startup (before `connectToDatabase`), so:
 *
 *  - in development, the automatic index build (`autoIndex`, the Mongoose
 *    default) creates the unique/partial/TTL indexes on connect, which means
 *    the database constraints are actually active while the app runs. Without
 *    this import, nothing would register the models and the indexes would
 *    never exist.
 *  - in production, index management will be handled deliberately during the
 *    deployment phase (`autoIndex: false`); see `docs/database-design.md`.
 *
 * Individual models are imported directly by name from their own files
 * (`import { User } from '../models/user.model.js'`); the barrel re-exports
 * them for callers that want one import site.
 */
import './application.model.js';
import './candidateProfile.model.js';
import './company.model.js';
import './companyMembership.model.js';
import './invitation.model.js';
import './job.model.js';
import './session.model.js';
import './user.model.js';

export { Application } from './application.model.js';
export { CandidateProfile } from './candidateProfile.model.js';
export { Company } from './company.model.js';
export { CompanyMembership } from './companyMembership.model.js';
export { Invitation } from './invitation.model.js';
export { Job } from './job.model.js';
export { Session } from './session.model.js';
export { User } from './user.model.js';
