/**
 * Password hashing and verification.
 *
 * The only module in the system that knows how passwords become hashes. Route
 * and controller code never import this directly through business paths;
 * `services/auth.service.ts` is the consumer, which is what keeps
 * cryptographic details out of HTTP code.
 *
 * ## Why scrypt
 *
 * `NFR-S-002` requires "a modern salted, deliberately slow algorithm", and
 * Node's built-in `crypto.scrypt` is exactly that:
 *
 *  - **Memory-hard.** scrypt (RFC 7914) requires a large, tunable amount of
 *    memory to compute, which is what makes GPU/FPGA cracking rigs
 *    disproportionately expensive. bcrypt is deliberately slow but not
 *    memory-hard, and truncates passwords at 72 bytes.
 *  - **Salted.** Every hash uses a fresh 16-byte random salt, so identical
 *    passwords produce different hashes and a precomputed lookup table for one
 *    hash is useless for another.
 *  - **A real library, not a hand-rolled scheme.** This is OpenSSL's scrypt
 *    exposed through Node core -- the same implementation every major
 *    ecosystem uses. No new dependency is added, which removes a supply-chain
 *    surface for a security primitive (AGENTS.md §9) and means the algorithm
 *    cannot drift from its well-tested implementation.
 *  - **Upgradeable cost.** The cost parameters are stored *inside* the hash
 *    string, so when hardware gets faster the project can raise `N` and old
 *    hashes still verify (they carry their own parameters). This is the same
 *    idea bcrypt's `$2b$10$...` self-describing string uses.
 *
 * Alternatives rejected: bcrypt/bcryptjs (native build or extra dependency,
 * 72-byte truncation, not memory-hard), argon2 (the modern benchmark, but it
 * requires a native addon -- a build toolchain on every target machine), and
 * plain SHA-256 (fast, unsalted by default, explicitly forbidden by the phase
 * brief). scrypt is the strongest option that needs nothing new installed.
 *
 * ## Stored format
 *
 * ```text
 * scrypt:<N>:<r>:<p>:<salt-base64url>:<hash-base64url>
 * ```
 *
 * Colon separators are safe because the values themselves are base64url, whose
 * alphabet (`A-Z a-z 0-9 - _`) contains no colon. `verifyPassword` parses this
 * string and re-derives with the stored parameters; it never assumes the
 * current defaults.
 *
 * ## Cost choice
 *
 * `N = 16384, r = 8, p = 1` costs ~16 MiB of memory and tens of milliseconds
 * per derivation -- appropriate for an MVP on a development machine and for a
 * fast test suite. The format supports raising `N` later without invalidating
 * existing hashes. Production guidance (OWASP) is `N = 2^17` or higher; that
 * is a one-line constant change plus a note that old hashes keep working.
 */
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';

/** The tunable scrypt cost parameters used for a derivation. */
interface ScryptCost {
  readonly N: number;
  readonly r: number;
  readonly p: number;
}

/**
 * Promisified scrypt. `node:util`'s `promisify` cannot type overloaded Node
 * functions like `scrypt` (it resolves to an unusable 3-argument signature),
 * so the callback is wrapped by hand -- the wrapper is the intended
 * "how to call scrypt" contract of this module.
 */
function scryptAsync(
  password: string,
  salt: Buffer,
  keyLength: number,
  cost: ScryptCost,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keyLength, cost, (error, derivedKey) => {
      if (error !== null) {
        reject(error);
        return;
      }
      resolve(derivedKey);
    });
  });
}

/** Derivation parameters used for *new* hashes. Verification reads them from the stored string. */
const SCRYPT_COST = { N: 16384, r: 8, p: 1 };

/** Output key length in bytes. 64 for scrypt's full output range. */
const KEY_LENGTH_BYTES = 64;

/** Salt length in bytes: 128 bits. */
const SALT_LENGTH_BYTES = 16;

/** Marker so `verifyPassword` can reject non-scrypt strings outright. */
const FORMAT_VERSION = 'scrypt';

interface ParsedHash {
  readonly n: number;
  readonly r: number;
  readonly p: number;
  readonly salt: Buffer;
  readonly expected: Buffer;
}

/**
 * Derive a self-describing scrypt hash for a password.
 *
 * `hashPassword` is deliberately the only place `randomBytes` contributes a
 * salt; verification never reuses the salt (it is read from the stored hash).
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH_BYTES);
  const derived = await scryptAsync(password, salt, KEY_LENGTH_BYTES, SCRYPT_COST);

  return [
    FORMAT_VERSION,
    SCRYPT_COST.N.toString(),
    SCRYPT_COST.r.toString(),
    SCRYPT_COST.p.toString(),
    salt.toString('base64url'),
    derived.toString('base64url'),
  ].join(':');
}

/**
 * Check a password against a stored hash, using the hashing library's intended
 * comparison operation (re-derive with the stored salt/parameters, then
 * constant-time compare) -- never plaintext comparison.
 *
 * Returns `false` instead of throwing for malformed stored values: a corrupt
 * record is an invalid credential, not a server failure, and callers should
 * not need a `try/catch` around "did the password match".
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parseStoredHash(stored);
  if (parsed === null) {
    return false;
  }

  try {
    const derived = await scryptAsync(password, parsed.salt, KEY_LENGTH_BYTES, {
      N: parsed.n,
      r: parsed.r,
      p: parsed.p,
    });

    // Constant-time comparison: the two buffers are always the same length
    // (both KEY_LENGTH_BYTES), so `timingSafeEqual` never early-exits on a
    // length mismatch, which would otherwise reveal how much of the hash
    // matched.
    return timingSafeEqual(derived, parsed.expected);
  } catch {
    return false;
  }
}

/** Split and validate the stored format. Returns `null` for anything not ours. */
function parseStoredHash(stored: string): ParsedHash | null {
  const parts = stored.split(':');
  if (parts.length !== 6) {
    return null;
  }

  const [version, nRaw, rRaw, pRaw, saltRaw, hashRaw] = parts;
  if (
    version === undefined ||
    nRaw === undefined ||
    rRaw === undefined ||
    pRaw === undefined ||
    saltRaw === undefined ||
    hashRaw === undefined
  ) {
    return null;
  }

  // Must start with our version marker; anything else is a foreign format.
  if (version !== FORMAT_VERSION) {
    return null;
  }

  const n = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  if (
    !Number.isSafeInteger(n) ||
    n <= 0 ||
    !Number.isSafeInteger(r) ||
    r <= 0 ||
    !Number.isSafeInteger(p) ||
    p <= 0
  ) {
    return null;
  }

  // base64url ignores characters outside its alphabet, so a string that is
  // "close" decodes to a shorter buffer -- the length check below rejects it.
  const salt = Buffer.from(saltRaw, 'base64url');
  const expected = Buffer.from(hashRaw, 'base64url');
  if (salt.length !== SALT_LENGTH_BYTES || expected.length !== KEY_LENGTH_BYTES) {
    return null;
  }

  return { n, r, p, salt, expected };
}
