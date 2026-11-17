import { describe, expect, it } from "vitest";

import { signUpErrorField } from "./sign-up-errors";

describe("signUpErrorField", () => {
  it("puts duplicate and invalid emails on the email field", () => {
    for (const code of [
      "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL",
      "USER_ALREADY_EXISTS",
      "INVALID_EMAIL",
    ]) {
      expect(signUpErrorField(code)).toBe("email");
    }
  });

  it("puts everything else on the password field", () => {
    for (const code of [
      "PASSWORD_TOO_SHORT",
      "PASSWORD_TOO_LONG",
      "FAILED_TO_CREATE_USER",
      undefined,
    ]) {
      expect(signUpErrorField(code)).toBe("password");
    }
  });
});
