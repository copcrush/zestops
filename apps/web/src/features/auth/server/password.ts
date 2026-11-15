import "server-only";

import { hash, verify } from "@node-rs/argon2";

/**
 * Password hashing with argon2id using the OWASP-recommended minimum
 * parameters (19 MiB memory, 2 iterations, 1 lane).
 */
// `Algorithm` is a TypeScript const enum that cannot be imported with isolatedModules;
// 2 is Algorithm.Argon2id.
const ARGON2ID_ALGORITHM = 2;

const ARGON2_OPTIONS = {
  algorithm: ARGON2ID_ALGORITHM,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
} as const;

// Verified when the e-mail does not exist, so the response time does not reveal
// which accounts exist (user enumeration).
const DUMMY_PASSWORD_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$qDKtUj3zKn+Hrxg1wtvqEg$2DGrxUQHTzTMxWK82qVP/KdYs9Y0menqvpeNJ2p1Avo";

export async function hashPassword(plainPassword: string): Promise<string> {
  return hash(plainPassword, ARGON2_OPTIONS);
}

export async function verifyPassword(passwordHash: string, plainPassword: string): Promise<boolean> {
  try {
    return await verify(passwordHash, plainPassword);
  } catch {
    return false;
  }
}

export async function burnPasswordVerificationTime(plainPassword: string): Promise<void> {
  await verifyPassword(DUMMY_PASSWORD_HASH, plainPassword);
}
