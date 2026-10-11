import assert from "node:assert/strict";
import test from "node:test";
import { generateTotp, normalizeTotpSecret, parseTotpUri } from "./client/totp";

test("generates RFC 6238 SHA1 codes at fixed times", async () => {
  const config = { secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", issuer: "", account: "test", algorithm: "SHA1" as const, digits: 8 as const, period: 30 };
  assert.equal(await generateTotp(config, 59_000), "94287082");
  assert.equal(await generateTotp({ ...config, digits: 6 }, 59_000), "287082");
  assert.equal(await generateTotp(config, 1_111_111_109_000), "07081804");
  assert.equal(await generateTotp(config, 2_000_000_000_000), "69279037");
});

test("generates RFC 6238 SHA256 code", async () => {
  const config = { secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZA", issuer: "", account: "test", algorithm: "SHA256" as const, digits: 8 as const, period: 30 };
  assert.equal(await generateTotp(config, 59_000), "46119246");
});

test("imports standard otpauth URIs and validates secrets", () => {
  assert.deepEqual(parseTotpUri("otpauth://totp/GitHub:alice%40example.com?secret=jbsw-y3dp%20ehpk3pxp&issuer=GitHub"), {
    secret: "JBSWY3DPEHPK3PXP", issuer: "GitHub", account: "alice@example.com", algorithm: "SHA1", digits: 6, period: 30,
  });
  assert.equal(normalizeTotpSecret("jbsw-y3dp ehpk3pxp===="), "JBSWY3DPEHPK3PXP");
  assert.throws(() => parseTotpUri("otpauth://hotp/test?secret=JBSWY3DPEHPK3PXP"));
  assert.throws(() => parseTotpUri("otpauth://totp/test?secret=INVALID0"));
});
