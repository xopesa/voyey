import { jwtVerify, SignJWT } from "jose";

import { InvalidTokenError } from "./errors.js";

const JWT_ISSUER = "voyey-api";
const JWT_AUDIENCE = "voyey-miniapp";

export class JwtTokenService {
  private readonly secretKey: Uint8Array;

  public constructor(
    secret: string,
    private readonly expirationSeconds = 3600,
  ) {
    this.secretKey = new TextEncoder().encode(secret);
  }

  public issue(userId: string): Promise<string> {
    return new SignJWT({})
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setSubject(userId)
      .setIssuer(JWT_ISSUER)
      .setAudience(JWT_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${this.expirationSeconds}s`)
      .sign(this.secretKey);
  }

  public async verify(token: string): Promise<string> {
    try {
      const { payload } = await jwtVerify(token, this.secretKey, {
        algorithms: ["HS256"],
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
      });
      if (!payload.sub) throw new InvalidTokenError();
      return payload.sub;
    } catch {
      throw new InvalidTokenError();
    }
  }
}
