import "server-only";

import { personalWorkspaceName } from "@timekeep/core";
import { getDb, schema } from "@timekeep/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { magicLink, organization } from "better-auth/plugins";

import { ac, roles } from "@/lib/permissions";

import { env } from "./env";
import { sendEmail } from "./mail";
import { createWorkspace, ensureWorkspaceSettings } from "./workspaces";

const ONE_DAY = 60 * 60 * 24;

function buildAuth() {
  const e = env();
  const db = getDb();

  return betterAuth({
    appName: "TimeKeep",
    baseURL: e.BETTER_AUTH_URL,
    secret: e.BETTER_AUTH_SECRET,
    trustedOrigins: [e.NEXT_PUBLIC_APP_URL],

    database: drizzleAdapter(db, { provider: "pg", schema }),

    user: {
      additionalFields: {
        timezone: { type: "string", required: false, input: true },
        dateFormat: { type: "string", required: false, input: true },
        timeFormat: { type: "string", required: false, input: true },
        weekStart: { type: "number", required: false, input: true },
      },
    },

    session: {
      expiresIn: ONE_DAY * 30,
      updateAge: ONE_DAY,
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },

    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      requireEmailVerification: true,
      sendResetPassword: async ({ user, url }) => {
        await sendEmail({
          to: user.email,
          subject: "Reset your TimeKeep password",
          title: "Reset your password",
          intro: `Hi ${user.name}, we received a request to reset the password for ${user.email}.`,
          cta: { label: "Choose a new password", url },
          outro: "If you did not ask for this, you can safely ignore this email. The link expires in 1 hour.",
        });
      },
    },

    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        await sendEmail({
          to: user.email,
          subject: "Verify your email for TimeKeep",
          title: "Confirm your email address",
          intro: `Hi ${user.name}, confirm ${user.email} to finish setting up your TimeKeep account.`,
          cta: { label: "Verify email", url },
          outro: "This link expires in 1 hour.",
        });
      },
    },

    socialProviders:
      e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET
        ? {
            google: {
              clientId: e.GOOGLE_CLIENT_ID,
              clientSecret: e.GOOGLE_CLIENT_SECRET,
            },
          }
        : {},

    databaseHooks: {
      user: {
        create: {
          // Every new user gets a personal workspace and becomes its OWNER.
          after: async (user) => {
            await createWorkspace(db, {
              name: personalWorkspaceName(user.name),
              ownerId: user.id,
            });
          },
        },
      },
    },

    plugins: [
      magicLink({
        expiresIn: 60 * 15,
        sendMagicLink: async ({ email, url }) => {
          await sendEmail({
            to: email,
            subject: "Your TimeKeep sign-in link",
            title: "Sign in to TimeKeep",
            intro: "Use the button below to sign in. No password needed.",
            cta: { label: "Sign in", url },
            outro: "This link expires in 15 minutes and can be used once.",
          });
        },
      }),

      organization({
        ac,
        roles,
        creatorRole: "owner",
        allowUserToCreateOrganization: true,
        invitationExpiresIn: ONE_DAY * 7,
        cancelPendingInvitationsOnReInvite: true,
        schema: {
          session: { fields: { activeOrganizationId: "activeWorkspaceId" } },
          organization: { modelName: "workspace" },
          member: {
            modelName: "membership",
            fields: { organizationId: "workspaceId" },
            additionalFields: {
              status: { type: "string", required: false, defaultValue: "ACTIVE", input: false },
            },
          },
          invitation: {
            modelName: "invitation",
            fields: { organizationId: "workspaceId" },
          },
        },
        sendInvitationEmail: async ({ id, email, organization: ws, inviter, role }) => {
          const url = `${e.NEXT_PUBLIC_APP_URL}/invite/${id}`;
          await sendEmail({
            to: email,
            subject: `${inviter.user.name} invited you to ${ws.name} on TimeKeep`,
            title: `Join ${ws.name}`,
            intro: `${inviter.user.name} (${inviter.user.email}) invited you to join the workspace "${ws.name}" as ${role}.`,
            cta: { label: "Accept invitation", url },
            outro: "This invitation expires in 7 days.",
          });
        },
        organizationHooks: {
          afterCreateOrganization: async ({ organization: ws }) => {
            await ensureWorkspaceSettings(db, ws.id);
          },
        },
      }),

      // Must be last: lets server actions set the session cookie.
      nextCookies(),
    ],
  });
}

let instance: ReturnType<typeof buildAuth> | undefined;

/** Lazily built so importing this module never touches env or the database. */
export function getAuth() {
  if (!instance) instance = buildAuth();
  return instance;
}

export type Auth = ReturnType<typeof buildAuth>;
export type AuthSession = NonNullable<Awaited<ReturnType<Auth["api"]["getSession"]>>>;
