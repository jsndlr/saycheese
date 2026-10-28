import { describe, expect, it } from "vitest";

import { parseEnv, readEnvSource } from "../convex/env";

const REQUIRED = {
  BETTER_AUTH_SECRET: "a".repeat(32),
  SITE_URL: "http://localhost:3001",
};

describe("parseEnv", () => {
  it("applies defaults with only the required keys", () => {
    expect(parseEnv({ ...REQUIRED })).toEqual({
      ...REQUIRED,
      SMILE_PROVIDER: "stub",
      SMILE_DAILY_QUOTA: 100,
      SCORING_CONFIG_VERSION: "1",
      LOG_LEVEL: "info",
    });
  });

  it("names the missing key when SITE_URL is absent", () => {
    const { SITE_URL: _omitted, ...rest } = REQUIRED;

    expect(() => parseEnv(rest)).toThrow(/SITE_URL/);
  });

  it("rejects a secret shorter than 32 characters", () => {
    expect(() => parseEnv({ ...REQUIRED, BETTER_AUTH_SECRET: "short" })).toThrow(
      /BETTER_AUTH_SECRET/,
    );
  });

  it("rejects a non-URL SITE_URL", () => {
    expect(() => parseEnv({ ...REQUIRED, SITE_URL: "localhost:3001" })).toThrow(/SITE_URL/);
  });

  it("coerces SMILE_DAILY_QUOTA and rejects non-positive values", () => {
    expect(parseEnv({ ...REQUIRED, SMILE_DAILY_QUOTA: "250" }).SMILE_DAILY_QUOTA).toBe(250);
    expect(() => parseEnv({ ...REQUIRED, SMILE_DAILY_QUOTA: "0" })).toThrow(
      /SMILE_DAILY_QUOTA/,
    );
  });

  it("names every AWS key missing for the rekognition provider", () => {
    expect(() => parseEnv({ ...REQUIRED, SMILE_PROVIDER: "rekognition" })).toThrow(
      /AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY/,
    );
  });

  it("accepts rekognition once all AWS keys are present", () => {
    const env = parseEnv({
      ...REQUIRED,
      SMILE_PROVIDER: "rekognition",
      AWS_REGION: "eu-central-1",
      AWS_ACCESS_KEY_ID: "AKIAEXAMPLE",
      AWS_SECRET_ACCESS_KEY: "aws-secret-value",
    });

    expect(env.SMILE_PROVIDER).toBe("rekognition");
    expect(env.AWS_REGION).toBe("eu-central-1");
  });

  it("rejects vision credentials that are not JSON", () => {
    expect(() =>
      parseEnv({
        ...REQUIRED,
        SMILE_PROVIDER: "vision",
        GOOGLE_APPLICATION_CREDENTIALS_JSON: "not-json",
      }),
    ).toThrow(/GOOGLE_APPLICATION_CREDENTIALS_JSON/);
  });

  it("requires vision credentials for the vision provider", () => {
    expect(() => parseEnv({ ...REQUIRED, SMILE_PROVIDER: "vision" })).toThrow(
      /GOOGLE_APPLICATION_CREDENTIALS_JSON/,
    );
  });

  it("never includes a supplied secret value in the error message", () => {
    const secrets = {
      BETTER_AUTH_SECRET: "b".repeat(31),
      AWS_SECRET_ACCESS_KEY: "super-secret-aws-value",
      GOOGLE_APPLICATION_CREDENTIALS_JSON: "super-secret-google-value",
    };

    const attempts = [
      { ...REQUIRED, BETTER_AUTH_SECRET: secrets.BETTER_AUTH_SECRET },
      {
        ...REQUIRED,
        SMILE_PROVIDER: "rekognition",
        AWS_REGION: "eu-central-1",
        AWS_ACCESS_KEY_ID: "AKIAEXAMPLE",
      },
      {
        ...REQUIRED,
        SMILE_PROVIDER: "vision",
        GOOGLE_APPLICATION_CREDENTIALS_JSON: secrets.GOOGLE_APPLICATION_CREDENTIALS_JSON,
      },
      {
        ...REQUIRED,
        SMILE_PROVIDER: "vision",
        GOOGLE_APPLICATION_CREDENTIALS_JSON: JSON.stringify({
          private_key: secrets.GOOGLE_APPLICATION_CREDENTIALS_JSON,
        }),
        AWS_SECRET_ACCESS_KEY: secrets.AWS_SECRET_ACCESS_KEY,
        AWS_REGION: "eu-central-1",
      },
    ];

    for (const source of attempts) {
      let message: string;
      try {
        parseEnv(source);
        continue;
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }

      for (const value of Object.values(secrets)) {
        expect(message).not.toContain(value);
      }
    }
  });
});

describe("readEnvSource", () => {
  it("reads values behind a proxy whose keys are not visible, like Convex's process.env", () => {
    // Convex exposes `process.env` as a proxy: property reads work, but the keys
    // are not visible to Zod's object parsing, which reports every key as missing.
    const backing: Record<string, string | undefined> = { ...REQUIRED };
    const source: Record<string, string | undefined> = new Proxy(Object.create(null), {
      get: (_target, key) => backing[String(key)],
    });

    expect(() => parseEnv(source)).toThrow(/BETTER_AUTH_SECRET/);
    expect(parseEnv(readEnvSource(source))).toMatchObject(REQUIRED);
  });
});
