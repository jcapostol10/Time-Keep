import { describe, expect, it } from "vitest";

import { kioskIdentifySchema, kioskPunchSchema, kioskSchema, pinSchema } from "./schemas";

describe("pinSchema", () => {
  it("takes 4 to 6 digits", () => {
    const short = pinSchema.safeParse({ pin: "123" });
    expect(short.error?.issues[0]?.message).toBe("A PIN is 4 to 6 digits.");
    expect(pinSchema.safeParse({ pin: "1234567" }).success).toBe(false);
    expect(pinSchema.safeParse({ pin: "12a4" }).success).toBe(false);
    expect(pinSchema.safeParse({ pin: "0042" }).success).toBe(true);
  });
});

describe("kioskSchema", () => {
  const base = { name: "Front desk", projectId: null, taskId: null, everyone: true };

  it("fills the defaults", () => {
    expect(kioskSchema.parse(base)).toMatchObject({
      sessionTimeoutSeconds: 15,
      showLogo: true,
      photo: false,
      userIds: [],
      groupIds: [],
    });
  });

  it("needs a project for a task", () => {
    expect(kioskSchema.safeParse({ ...base, taskId: "t1" }).success).toBe(false);
    expect(kioskSchema.safeParse({ ...base, projectId: "p1", taskId: "t1" }).success).toBe(true);
  });

  it("keeps the timeout between 5 and 300 seconds", () => {
    expect(kioskSchema.safeParse({ ...base, sessionTimeoutSeconds: 4 }).success).toBe(false);
    expect(kioskSchema.safeParse({ ...base, sessionTimeoutSeconds: 301 }).success).toBe(false);
    expect(kioskSchema.safeParse({ ...base, sessionTimeoutSeconds: 300 }).success).toBe(true);
  });

  it("needs a name", () => {
    expect(kioskSchema.safeParse({ ...base, name: " " }).success).toBe(false);
  });
});

describe("kioskIdentifySchema", () => {
  it("takes a PIN for a person, or a QR payload, not both", () => {
    expect(kioskIdentifySchema.safeParse({ userId: "u1", pin: "0042" }).success).toBe(true);
    expect(kioskIdentifySchema.safeParse({ qr: "tkq1.x" }).success).toBe(true);
    expect(
      kioskIdentifySchema.safeParse({ userId: "u1", pin: "0042", qr: "tkq1.x" }).success,
    ).toBe(false);
    expect(kioskIdentifySchema.safeParse({}).success).toBe(false);
  });
});

describe("kioskPunchSchema", () => {
  it("takes a ticket and a known action", () => {
    expect(kioskPunchSchema.safeParse({ ticket: "t", action: "CLOCK_IN" }).success).toBe(true);
    expect(kioskPunchSchema.safeParse({ ticket: "t", action: "LUNCH" }).success).toBe(false);
  });
});
