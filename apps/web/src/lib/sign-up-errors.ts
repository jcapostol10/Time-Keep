/** Better Auth sign-up error codes that are about the email address. */
const EMAIL_CODES = new Set([
  // What Better Auth 1.7 emits for a duplicate (moot while email
  // verification answers a duplicate with a generic success).
  "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL",
  "USER_ALREADY_EXISTS",
  "INVALID_EMAIL",
]);

/** The form field a sign-up error belongs on. */
export function signUpErrorField(code: string | undefined): "email" | "password" {
  return code !== undefined && EMAIL_CODES.has(code) ? "email" : "password";
}
