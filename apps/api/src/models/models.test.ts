/**
 * Phase 3 model tests -- schema validation and index definitions, offline.
 *
 * No MongoDB is needed: `validate()` runs the schema's own validation, and
 * `schema.indexes()` returns the declared index definitions. Runtime
 * data-integrity rules (uniqueness under concurrency, TTL deletion) are
 * properties MongoDB enforces once the indexes exist; those are verified
 * against the real database in a manual, reported step, not as part of the
 * test run (the suite stays fast and side-effect free, per the Phase 1
 * principle that tests must not depend on a live service).
 */
import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';

import {
  Application,
  CandidateProfile,
  Company,
  CompanyMembership,
  Invitation,
  Job,
  Session,
  User,
} from './index.js';
import {
  activeMatchesStatus,
  validStatusHistoryChain,
  type StatusHistoryEntry,
} from './application.model.js';
import {
  APPLICATION_STATUSES,
  isActiveApplicationStatus,
  isTerminalApplicationStatus,
} from './constants.js';
import { invitationTimestampsMatchStatus } from './invitation.model.js';

type SchemaCarryingModel = { schema: mongoose.Schema };

/** The indexes we declared, in one place, for the assertions below. */
function declaredIndexes(model: SchemaCarryingModel) {
  return (
    model.schema
      .indexes()
      // Mongoose always prepends the implicit _id index; drop it so the tests
      // assert only what this project declared.
      .filter(([key]) => !('_id' in key))
  );
}

function keyMatches(indexKey: Record<string, unknown>, expected: Record<string, unknown>): boolean {
  const entries = Object.entries(expected);
  return (
    entries.length === Object.keys(indexKey).length &&
    entries.every(([field, direction]) => indexKey[field] === direction)
  );
}

function findIndex(model: SchemaCarryingModel, key: Record<string, unknown>) {
  return declaredIndexes(model).find(([indexKey]) => keyMatches(indexKey, key));
}

/**
 * Runs `validate()` on a document and returns the promise it produces;
 * `.rejects` assertions are attached to a real promise, not a thrower.
 */
function validationErrorsOf(document: { validate: () => Promise<void> }): Promise<void> {
  return document.validate();
}

describe('model index definitions', () => {
  it('User: unique email, the one-account-per-email constraint (FR-004)', () => {
    const index = findIndex(User, { email: 1 });
    expect(index?.[1]).toMatchObject({ unique: true });
  });

  it('CandidateProfile: one profile per candidate (unique userId)', () => {
    const index = findIndex(CandidateProfile, { userId: 1 });
    expect(index?.[1]).toMatchObject({ unique: true });
  });

  it('CompanyMembership: a user belongs to at most one company (unique userId, FR-037)', () => {
    const index = findIndex(CompanyMembership, { userId: 1 });
    expect(index?.[1]).toMatchObject({ unique: true });
    // And a company-first lookup for "this company's members".
    expect(findIndex(CompanyMembership, { companyId: 1 })).toBeDefined();
  });

  it('Invitation: token lookup is unique, plus lifecycle indexes', () => {
    expect(findIndex(Invitation, { tokenHash: 1 })?.[1]).toMatchObject({ unique: true });
    expect(findIndex(Invitation, { invitedUserId: 1, status: 1 })).toBeDefined();
    expect(findIndex(Invitation, { companyId: 1, status: 1 })).toBeDefined();
  });

  it('Session: resolution lookup, per-user revocation, and TTL expiry', () => {
    expect(findIndex(Session, { tokenHash: 1 })?.[1]).toMatchObject({ unique: true });
    expect(findIndex(Session, { userId: 1 })).toBeDefined();

    const ttl = findIndex(Session, { expiresAt: 1 });
    expect(ttl?.[1]).toMatchObject({ expireAfterSeconds: 0 });
  });

  it('Job: browse published newest-first, plus company ownership view', () => {
    expect(findIndex(Job, { status: 1, publishedAt: -1 })).toBeDefined();
    expect(findIndex(Job, { companyId: 1, status: 1 })).toBeDefined();
  });

  it('Application: partial unique index expresses FR-057 for active applications only', () => {
    const partial = findIndex(Application, { candidateUserId: 1, jobId: 1 });
    expect(partial?.[1]).toMatchObject({
      unique: true,
      partialFilterExpression: { active: true },
    });
    expect(findIndex(Application, { candidateUserId: 1, createdAt: -1 })).toBeDefined();
    expect(findIndex(Application, { jobId: 1, status: 1 })).toBeDefined();
    expect(findIndex(Application, { companyId: 1, status: 1 })).toBeDefined();
  });
});

describe('User schema', () => {
  it('accepts a valid account', async () => {
    const user = new User({
      email: 'candidate@example.com',
      name: 'Ada Lovelace',
      passwordHash: 'x'.repeat(60),
      capabilities: ['CANDIDATE'],
    });
    await expect(user.validate()).resolves.toBeUndefined();
  });

  it('normalizes email to lowercase so the unique index is case-insensitive', () => {
    const user = new User({
      email: '  Ada@Example.COM ',
      name: 'Ada',
      passwordHash: 'x'.repeat(60),
      capabilities: ['CANDIDATE'],
    });
    expect(user.email).toBe('ada@example.com');
  });

  it('rejects a missing email and a too-short passwordHash', async () => {
    await expect(
      validationErrorsOf(
        new User({ name: 'X', passwordHash: 'short', capabilities: ['CANDIDATE'] }),
      ),
    ).rejects.toMatchObject({
      name: 'ValidationError',
      errors: expect.objectContaining({
        email: expect.anything(),
        passwordHash: expect.anything(),
      }),
    });
  });

  it('rejects an unknown capability value (closed set, D-001)', async () => {
    await expect(
      validationErrorsOf(
        new User({
          email: 'a@b.com',
          name: 'X',
          passwordHash: 'x'.repeat(60),
          capabilities: ['SUPERUSER'],
        }),
      ),
    ).rejects.toMatchObject({
      name: 'ValidationError',
      errors: expect.objectContaining({ 'capabilities.0': expect.anything() }),
    });
  });

  it('rejects an empty capability set and duplicate capabilities', async () => {
    const empty = new User({
      email: 'a@b.com',
      name: 'X',
      passwordHash: 'x'.repeat(60),
      capabilities: [],
    });
    await expect(validationErrorsOf(empty)).rejects.toMatchObject({ name: 'ValidationError' });

    const duplicated = new User({
      email: 'a@b.com',
      name: 'X',
      passwordHash: 'x'.repeat(60),
      capabilities: ['CANDIDATE', 'CANDIDATE'],
    });
    await expect(validationErrorsOf(duplicated)).rejects.toMatchObject({ name: 'ValidationError' });
  });

  it('allows both capabilities on one account (D-013)', async () => {
    const both = new User({
      email: 'both@example.com',
      name: 'Both',
      passwordHash: 'x'.repeat(60),
      capabilities: ['CANDIDATE', 'RECRUITER'],
    });
    await expect(both.validate()).resolves.toBeUndefined();
  });

  it('never serializes the password hash (FR-005, NFR-S-002)', () => {
    const user = new User({
      email: 'a@b.com',
      name: 'X',
      passwordHash: 'x'.repeat(60),
      capabilities: ['CANDIDATE'],
    });

    const json = user.toJSON() as Record<string, unknown>;

    expect(json).not.toHaveProperty('passwordHash');
    expect(json['email']).toBe('a@b.com');
    expect(json['capabilities']).toEqual(['CANDIDATE']);
  });
});

describe('CandidateProfile schema', () => {
  const profile = () =>
    new CandidateProfile({
      userId: new mongoose.Types.ObjectId(),
      headline: 'Software Engineer',
      skills: ['TypeScript', 'MongoDB'],
      resume: null,
    });

  it('accepts a valid profile with no résumé', async () => {
    await expect(profile().validate()).resolves.toBeUndefined();
  });

  it('rejects a profile without a user reference', async () => {
    const withoutUser = new CandidateProfile({ headline: 'X' });
    await expect(validationErrorsOf(withoutUser)).rejects.toMatchObject({
      name: 'ValidationError',
    });
  });

  it('rejects an experience entry that ends before it starts (FR-018)', async () => {
    const bad = profile();
    bad.experience.push({
      role: 'Intern',
      organisation: 'Acme',
      startDate: new Date('2025-01-01'),
      endDate: new Date('2024-01-01'),
    });
    await expect(validationErrorsOf(bad)).rejects.toMatchObject({ name: 'ValidationError' });
  });

  it('accepts a current (open-ended) experience entry', async () => {
    const ok = profile();
    ok.experience.push({
      role: 'Engineer',
      organisation: 'Acme',
      startDate: new Date('2024-01-01'),
      endDate: null,
    });
    await expect(ok.validate()).resolves.toBeUndefined();
  });

  it('validates the résumé reference shape (FR-029)', async () => {
    const badResume = profile();
    badResume.set('resume', {
      originalFilename: 'cv.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 100,
      uploadedAt: new Date(),
    });
    await expect(validationErrorsOf(badResume)).rejects.toMatchObject({ name: 'ValidationError' });
  });
});

describe('Company schema', () => {
  const settings = { expiryHours: 72, maxPendingInvitations: 5 };

  it('accepts a valid company with invitation settings', async () => {
    const company = new Company({ name: 'Acme', invitationSettings: settings });
    await expect(company.validate()).resolves.toBeUndefined();
  });

  it('requires invitation settings (FR-098: company-configurable, no invented defaults)', async () => {
    const company = new Company({ name: 'Acme' });
    await expect(validationErrorsOf(company)).rejects.toMatchObject({ name: 'ValidationError' });
  });

  it('rejects non-positive or non-integer settings (data integrity, not a policy bound)', async () => {
    for (const bad of [
      { expiryHours: 0, maxPendingInvitations: 5 },
      { expiryHours: 1.5, maxPendingInvitations: 5 },
      { expiryHours: 72, maxPendingInvitations: 0 },
    ]) {
      const company = new Company({ name: 'Acme', invitationSettings: bad });
      await expect(validationErrorsOf(company)).rejects.toMatchObject({ name: 'ValidationError' });
    }
  });
});

describe('Invitation schema', () => {
  const valid = () =>
    new Invitation({
      companyId: new mongoose.Types.ObjectId(),
      invitedUserId: new mongoose.Types.ObjectId(),
      invitedByUserId: new mongoose.Types.ObjectId(),
      invitedEmail: 'ADA@Example.com',
      tokenHash: 'a'.repeat(64),
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 86_400_000),
      acceptedAt: null,
      declinedAt: null,
      expiredAt: null,
    });

  it('accepts a valid pending invitation and normalizes the email', async () => {
    const invitation = valid();
    expect(invitation.invitedEmail).toBe('ada@example.com');
    await expect(invitation.validate()).resolves.toBeUndefined();
  });

  it('rejects an unknown status (FR-098 lifecycle is a closed set)', async () => {
    const invitation = valid();
    // `.set()` deliberately bypasses TypeScript's static type so the schema's
    // runtime enum validation is what rejects the bad value.
    invitation.set('status', 'REVOKED');
    await expect(validationErrorsOf(invitation)).rejects.toMatchObject({ name: 'ValidationError' });
  });

  it('rejects a token hash that is not a 64-hex digest', async () => {
    const plaintext = valid();
    plaintext.tokenHash = 'raw-token-accidentally-stored';
    await expect(validationErrorsOf(plaintext)).rejects.toMatchObject({ name: 'ValidationError' });
  });

  it('rejects a status that disagrees with its timestamp (PENDING with acceptedAt)', async () => {
    const inconsistent = valid();
    inconsistent.acceptedAt = new Date();
    await expect(validationErrorsOf(inconsistent)).rejects.toThrow(/timestamp are inconsistent/);
  });

  it('accepts ACCEPTED only with an acceptedAt timestamp', async () => {
    const accepted = valid();
    accepted.status = 'ACCEPTED';
    accepted.acceptedAt = new Date();
    await expect(accepted.validate()).resolves.toBeUndefined();
  });

  it('invitationTimestampsMatchStatus is the pure truth table beside the hook', () => {
    expect(invitationTimestampsMatchStatus(valid())).toBe(true);
    expect(
      invitationTimestampsMatchStatus({
        status: 'ACCEPTED',
        acceptedAt: null,
        declinedAt: null,
        expiredAt: null,
      }),
    ).toBe(false);
    expect(
      invitationTimestampsMatchStatus({
        status: 'ACCEPTED',
        acceptedAt: new Date(),
        declinedAt: null,
        expiredAt: null,
      }),
    ).toBe(true);
  });
});

describe('Session schema', () => {
  it('accepts a valid session', async () => {
    const session = new Session({
      tokenHash: 'b'.repeat(64),
      userId: new mongoose.Types.ObjectId(),
      expiresAt: new Date(Date.now() + 3_600_000),
      lastUsedAt: new Date(),
    });
    await expect(session.validate()).resolves.toBeUndefined();
  });

  it('rejects a missing expiry and a raw (non-hashed) session identifier', async () => {
    const noExpiry = new Session({
      tokenHash: 'c'.repeat(64),
      userId: new mongoose.Types.ObjectId(),
      lastUsedAt: new Date(),
    });
    await expect(validationErrorsOf(noExpiry)).rejects.toMatchObject({ name: 'ValidationError' });

    const raw = new Session({
      tokenHash: 'opaque-session-id',
      userId: new mongoose.Types.ObjectId(),
      expiresAt: new Date(),
      lastUsedAt: new Date(),
    });
    await expect(validationErrorsOf(raw)).rejects.toMatchObject({ name: 'ValidationError' });
  });
});

describe('Job schema', () => {
  const job = () =>
    new Job({
      companyId: new mongoose.Types.ObjectId(),
      createdByUserId: new mongoose.Types.ObjectId(),
      title: 'Backend Engineer',
      description: 'Build APIs.',
      location: 'Remote',
      employmentType: 'FULL_TIME',
      skills: ['Node.js'],
    });

  it('accepts a valid draft job', async () => {
    await expect(job().validate()).resolves.toBeUndefined();
  });

  it('rejects an unknown employment type and an unknown status', async () => {
    const badType = job();
    badType.set('employmentType', 'FREELANCE');
    await expect(validationErrorsOf(badType)).rejects.toMatchObject({ name: 'ValidationError' });

    const badStatus = job();
    badStatus.set('status', 'ARCHIVED');
    await expect(validationErrorsOf(badStatus)).rejects.toMatchObject({ name: 'ValidationError' });
  });

  it('rejects a salary range whose max is below its min', async () => {
    const bad = job();
    bad.salaryRange = { min: 90_000, max: 70_000, currency: 'USD' };
    await expect(validationErrorsOf(bad)).rejects.toMatchObject({ name: 'ValidationError' });
  });
});

describe('Application schema and status semantics', () => {
  const entry = (
    status: string,
    previousStatus: string | null,
    changedBy = new mongoose.Types.ObjectId(),
  ): StatusHistoryEntry => ({
    previousStatus: previousStatus as StatusHistoryEntry['previousStatus'],
    status: status as StatusHistoryEntry['status'],
    changedByUserId: changedBy,
    changedAt: new Date(),
  });

  const application = () =>
    new Application({
      candidateUserId: new mongoose.Types.ObjectId(),
      jobId: new mongoose.Types.ObjectId(),
      companyId: new mongoose.Types.ObjectId(),
      status: 'APPLIED',
      active: true,
      resumeSnapshot: {
        assetId: 'cv-public-id',
        originalFilename: 'cv.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 2048,
        uploadedAt: new Date(),
      },
      statusHistory: [entry('APPLIED', null)],
    });

  it('accepts a valid new application starting at APPLIED (FR-058)', async () => {
    await expect(application().validate()).resolves.toBeUndefined();
  });

  it('rejects a status outside the controlled set (FR-059)', async () => {
    const bad = application();
    bad.set('status', 'ON_HOLD');
    await expect(validationErrorsOf(bad)).rejects.toMatchObject({ name: 'ValidationError' });
  });

  it('isTerminalApplicationStatus and isActiveApplicationStatus match 10.6.1 exactly', () => {
    const terminal = new Set(['HIRED', 'REJECTED', 'WITHDRAWN']);
    for (const status of APPLICATION_STATUSES) {
      expect(isTerminalApplicationStatus(status)).toBe(terminal.has(status));
      expect(isActiveApplicationStatus(status)).toBe(!terminal.has(status));
    }
  });

  it('rejects an empty history (schema) and a broken chain (hook or validator)', async () => {
    const broken = application();
    broken.statusHistory = [entry('APPLIED', null), entry('UNDER_REVIEW', 'SHORTLISTED')];
    // The chain is illegal: the app's status is APPLIED, the last history
    // entry is UNDER_REVIEW, and the linkage is wrong. Either the schema hook
    // (last-entry check) or the chain validator rejects it -- both must reject.
    await expect(validationErrorsOf(broken)).rejects.toThrow();

    const empty = application();
    empty.statusHistory = [];
    await expect(validationErrorsOf(empty)).rejects.toMatchObject({ name: 'ValidationError' });
  });

  it('accepts the full legal path of 6 entries and rejects a 7th', async () => {
    const full = application();
    full.statusHistory = [
      entry('APPLIED', null),
      entry('UNDER_REVIEW', 'APPLIED'),
      entry('SHORTLISTED', 'UNDER_REVIEW'),
      entry('INTERVIEW', 'SHORTLISTED'),
      entry('OFFERED', 'INTERVIEW'),
      entry('HIRED', 'OFFERED'),
    ];
    full.status = 'HIRED';
    full.active = false;
    await expect(full.validate()).resolves.toBeUndefined();

    // A 7th entry that still respects the chain linkage and ends at the
    // current status (HIRED -> HIRED), so the schema hook passes and only the
    // length bound (10.6.1: history capped at 6 entries) is exercised.
    const tooLong = [...full.statusHistory, entry('HIRED', 'HIRED')];
    full.statusHistory = tooLong;
    await expect(validationErrorsOf(full)).rejects.toMatchObject({ name: 'ValidationError' });
  });

  it('rejects active/status disagreement (the invariant behind FR-057)', async () => {
    const inconsistent = application();
    inconsistent.status = 'HIRED';
    inconsistent.active = true;
    await expect(validationErrorsOf(inconsistent)).rejects.toThrow(/active must reflect/);
  });

  it('rejects a history whose last entry disagrees with the current status', async () => {
    const stale = application();
    stale.statusHistory = [entry('APPLIED', null), entry('UNDER_REVIEW', 'APPLIED')];
    await expect(validationErrorsOf(stale)).rejects.toThrow(/last statusHistory entry/);
  });

  it('validStatusHistoryChain and activeMatchesStatus are pure and testable', () => {
    expect(validStatusHistoryChain([entry('APPLIED', null)])).toBe(true);
    expect(validStatusHistoryChain([])).toBe(false);
    expect(validStatusHistoryChain([entry('APPLIED', 'UNDER_REVIEW')])).toBe(false);
    expect(activeMatchesStatus(true, 'APPLIED')).toBe(true);
    expect(activeMatchesStatus(false, 'APPLIED')).toBe(false);
    expect(activeMatchesStatus(false, 'HIRED')).toBe(true);
  });
});
