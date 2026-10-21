export interface PasswordChallenge {
  salt: string;
  iterations: number;
}

// The derived key is a password-equivalent credential: HTTPS request body only,
// never localStorage, URLs, logs, or cookies.
export async function deriveAdminPasswordProof(
  password: string,
  challenge: PasswordChallenge,
) {
  if (
    !/^[a-f0-9]{64}$/.test(challenge.salt) ||
    challenge.iterations !== 600000 ||
    !password ||
    password.length > 1024
  )
    throw new Error("Invalid password challenge");
  const salt = Uint8Array.from(challenge.salt.match(/../g)!, (byte) =>
    parseInt(byte, 16),
  );
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const proof = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: challenge.iterations },
    key,
    256,
  );
  return Array.from(new Uint8Array(proof), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
