"use client";

import { inferAdditionalFields, magicLinkClient, organizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

import type { Auth } from "@/server/auth";

import { ac, roles } from "./permissions";

export const authClient = createAuthClient({
  plugins: [
    inferAdditionalFields<Auth>(),
    magicLinkClient(),
    organizationClient({ ac, roles }),
  ],
});

export const { useSession, signIn, signUp, signOut } = authClient;

/** Human-readable message from a Better Auth error response. */
export function authErrorMessage(error: { message?: string; code?: string } | null | undefined) {
  if (!error) return "Something went wrong. Please try again.";
  return error.message ?? error.code ?? "Something went wrong. Please try again.";
}
