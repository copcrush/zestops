import "server-only";

import { randomUUID } from "node:crypto";

import { type CryptoKey, importPKCS8, SignJWT } from "jose";

import { getServerEnvironment } from "@/lib/server/env";
import type { Role } from "@/types/auth";

/**
 * Signs the short-lived internal JWT that proves to a backend service WHO is
 * calling (user ID + role). Only this server holds the private key; backends
 * verify with the public key (see ADR-0002).
 */
export type BackendAudience = "zestops-payment-api" | "zestops-monitoring-api";

const TOKEN_LIFETIME_SECONDS = 60;

let privateKeyPromise: Promise<CryptoKey> | undefined;

function getPrivateKey(): Promise<CryptoKey> {
  privateKeyPromise ??= importPKCS8(
    Buffer.from(getServerEnvironment().INTERNAL_JWT_PRIVATE_KEY_BASE64, "base64").toString("utf8"),
    "EdDSA",
  );
  return privateKeyPromise;
}

export async function signInternalToken(actor: { id: string; role: Role }, audience: BackendAudience):
  Promise<string> {
  const environment = getServerEnvironment();
  const issuedAt = Math.floor(Date.now() / 1000);
  return new SignJWT({ role: actor.role })
    .setProtectedHeader({ alg: "EdDSA", typ: "JWT", kid: environment.INTERNAL_JWT_KEY_ID })
    .setIssuer(environment.INTERNAL_JWT_ISSUER)
    .setAudience(audience)
    .setSubject(actor.id)
    .setIssuedAt(issuedAt)
    .setNotBefore(issuedAt)
    .setExpirationTime(issuedAt + TOKEN_LIFETIME_SECONDS)
    .setJti(randomUUID())
    .sign(await getPrivateKey());
}
