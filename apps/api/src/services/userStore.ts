/**
 * The MongoDB implementation of the auth service's persistence boundary.
 *
 * Everything this module knows about (Mongoose, the `User` model, document
 * mapping) is hidden from the HTTP layer: `createAuthService` receives only the
 * `UserStore` interface, and this file is wired once, in `server.ts`.
 *
 * The mapping from a Mongoose document to the plain `UserAccount` shape is the
 * important detail: it is the *only* place where the stored document becomes a
 * value the auth logic can pass around, and it deliberately copies only the
 * fields the auth logic is allowed to see. `passwordHash` is copied here
 * because verification needs it, but the response mapping in `auth.service.ts`
 * (`toSafeUser`) drops it long before anything reaches the wire.
 */
import type { HydratedDocument } from 'mongoose';

import type { UserDoc } from '../models/user.model.js';
import { User } from '../models/user.model.js';
import type { NewUserInput, UserAccount, UserStore } from './auth.service.js';

type UserDocument = HydratedDocument<UserDoc>;

function toAccount(doc: UserDocument): UserAccount {
  return {
    // `_id` is typed (`Types.ObjectId`) on a hydrated document, whereas
    // Mongoose's virtual `id` getter is typed `any` and would trip the
    // repo-wide no-unsafe-assignment rule.
    id: doc._id.toString(),
    email: doc.email,
    name: doc.name,
    capabilities: [...doc.capabilities],
    passwordHash: doc.passwordHash,
  };
}

/** The production store backed by the `users` collection. */
export function createUserStore(): UserStore {
  return {
    async insertAccount(input: NewUserInput): Promise<UserAccount> {
      // `new ... save()` instead of `Model.create()`: `create` resolves to `any`
      // in Mongoose's typings, which the repo's lint rejects. `save()` on a
      // hydrated document is fully typed and behaves identically.
      const user = new User({
        email: input.email,
        name: input.name,
        passwordHash: input.passwordHash,
        capabilities: [...input.capabilities],
      });

      const doc = await user.save();
      return toAccount(doc);
    },

    async findByEmail(email: string): Promise<UserAccount | null> {
      const doc = await User.findOne({ email });
      return doc === null ? null : toAccount(doc);
    },
  };
}
