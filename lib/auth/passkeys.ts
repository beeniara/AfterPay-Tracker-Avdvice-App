import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransport,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import type { DbClient } from "@/lib/db";
import { passkeys, type Passkey, type User } from "@/lib/db/schema";
import { CHALLENGE_COOKIE } from "./constants";

const RP_NAME = "Owing";

export function relyingParty(request: Request): { rpID: string; origin: string } {
  const url = new URL(request.url);
  const host = request.headers.get("host") ?? url.host;
  const proto = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  return { rpID: host.split(":")[0]!, origin: `${proto}://${host}` };
}

async function rememberChallenge(challenge: string): Promise<void> {
  (await cookies()).set(CHALLENGE_COOKIE, challenge, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/auth/passkey",
    maxAge: 300,
  });
}

async function takeChallenge(): Promise<string | null> {
  const store = await cookies();
  const value = store.get(CHALLENGE_COOKIE)?.value ?? null;
  store.delete(CHALLENGE_COOKIE);
  return value;
}

function transportsOf(passkey: Passkey): AuthenticatorTransport[] | undefined {
  return passkey.transports ? (passkey.transports.split(",") as AuthenticatorTransport[]) : undefined;
}

export async function registrationOptions(db: DbClient, user: User, rpID: string) {
  const existing = await db.query.passkeys.findMany({ where: eq(passkeys.userId, user.id) });
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID,
    userName: user.email,
    userDisplayName: user.name ?? user.email,
    userID: new TextEncoder().encode(user.id),
    attestationType: "none",
    excludeCredentials: existing.map((p) => ({ id: p.credentialId, transports: transportsOf(p) })),
    authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
  });
  await rememberChallenge(options.challenge);
  return options;
}

export async function completeRegistration(
  db: DbClient,
  user: User,
  response: RegistrationResponseJSON,
  name: string | null,
  rp: { rpID: string; origin: string },
): Promise<Passkey> {
  const expectedChallenge = await takeChallenge();
  if (!expectedChallenge) throw new Error("Passkey challenge expired — try again");
  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge,
    expectedOrigin: rp.origin,
    expectedRPID: rp.rpID,
  });
  if (!verification.verified || !verification.registrationInfo) {
    throw new Error("Passkey could not be verified");
  }
  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
  const [row] = await db
    .insert(passkeys)
    .values({
      userId: user.id,
      credentialId: credential.id,
      publicKey: isoBase64URL.fromBuffer(credential.publicKey),
      counter: credential.counter,
      transports: credential.transports?.join(",") ?? null,
      deviceType: credentialDeviceType,
      backedUp: credentialBackedUp,
      name,
    })
    .returning();
  return row!;
}

export async function authenticationOptions(rpID: string) {
  const options = await generateAuthenticationOptions({ rpID, userVerification: "preferred" });
  await rememberChallenge(options.challenge);
  return options;
}

export async function completeAuthentication(
  db: DbClient,
  response: AuthenticationResponseJSON,
  rp: { rpID: string; origin: string },
): Promise<string> {
  const expectedChallenge = await takeChallenge();
  if (!expectedChallenge) throw new Error("Passkey challenge expired — try again");
  const passkey = await db.query.passkeys.findFirst({ where: eq(passkeys.credentialId, response.id) });
  if (!passkey) throw new Error("Unknown passkey");

  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge,
    expectedOrigin: rp.origin,
    expectedRPID: rp.rpID,
    credential: {
      id: passkey.credentialId,
      publicKey: isoBase64URL.toBuffer(passkey.publicKey),
      counter: passkey.counter,
      transports: transportsOf(passkey),
    },
  });
  if (!verification.verified) throw new Error("Passkey could not be verified");

  await db
    .update(passkeys)
    .set({ counter: verification.authenticationInfo.newCounter, lastUsedAt: new Date() })
    .where(eq(passkeys.id, passkey.id));
  return passkey.userId;
}
