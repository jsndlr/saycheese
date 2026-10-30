import { mapProviderResult } from "@saycheese/core/scoring";
import { afterEach, describe, expect, it, vi } from "vitest";

import { providerFor, providerOrder } from "../convex/lib/providers";
import {
  classifyDeepSeekStatus,
  createDeepSeekProvider,
  DEEPSEEK_COST_MICROS_PER_IMAGE,
  DEEPSEEK_DEFAULT_MODEL,
  DEEPSEEK_MAX_OUTPUT_TOKENS,
  parseDeepSeekAnswer,
} from "../convex/lib/providers/deepseek";
import { ProviderError } from "../convex/lib/providers/types";

/**
 * DeepSeek adapter: reply parsing, HTTP classification and transport. The
 * network is replaced with a stub `fetch`; no key is involved.
 */

const FACE = {
  area: 0.3,
  smiling: true,
  smileConfidence: 91,
  faceConfidence: 98,
  sharpness: 70,
};

function reply(content: string, init: ResponseInit = { status: 200 }): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), init);
}

function stubFetch(response: Response | Error) {
  const fetchMock = vi.fn(async () => {
    if (response instanceof Error) {
      throw response;
    }
    return response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const input = { bytes: new Uint8Array([1, 2, 3]), mime: "image/webp", sha256: "x" };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseDeepSeekAnswer", () => {
  it("maps a face to the provider contract", () => {
    const [face] = parseDeepSeekAnswer(JSON.stringify({ faces: [FACE] }));

    expect(face).toEqual({
      area: 0.3,
      smileConfidence: 91,
      smileValue: true,
      faceConfidence: 98,
      sharpness: 70,
    });
  });

  it("accepts a fenced reply and an empty face list", () => {
    expect(parseDeepSeekAnswer('```json\n{"faces":[]}\n```')).toEqual([]);
  });

  it("clamps out-of-range numbers instead of trusting them", () => {
    const [face] = parseDeepSeekAnswer(
      JSON.stringify({ faces: [{ ...FACE, area: 5, smileConfidence: 400, faceConfidence: -3 }] }),
    );

    expect(face).toMatchObject({ area: 1, smileConfidence: 100, faceConfidence: 0 });
  });

  it("keeps every face so the largest is found even when it comes last", () => {
    const faces = Array.from({ length: 12 }, (_, index) => ({
      ...FACE,
      area: index === 11 ? 0.9 : 0.05,
    }));

    const parsed = parseDeepSeekAnswer(JSON.stringify({ faces }));

    expect(parsed).toHaveLength(12);
    expect(Math.max(...parsed.map((face) => face.area))).toBe(0.9);
  });

  it("treats a missing sharpness as no signal", () => {
    const { sharpness: _unused, ...withoutSharpness } = FACE;
    const [face] = parseDeepSeekAnswer(JSON.stringify({ faces: [withoutSharpness] }));

    expect(face?.sharpness).toBeNull();
  });

  it("rejects non-JSON and wrong shapes as a retryable bad output", () => {
    for (const bad of ["not json", '{"faces":"none"}', '{"faces":[{"smiling":"yes"}]}']) {
      expect(() => parseDeepSeekAnswer(bad)).toThrowError(ProviderError);
      try {
        parseDeepSeekAnswer(bad);
      } catch (error) {
        expect(error).toMatchObject({ kind: "retryable", code: "bad_output" });
      }
    }
  });

  it("feeds core scoring: a confident smile scores high, a confident non-smile low", () => {
    const smiling = mapProviderResult(
      { faces: parseDeepSeekAnswer(JSON.stringify({ faces: [FACE] })), latencyMs: 1, costMicros: 1 },
      { provider: "deepseek", providerModel: "m", cached: false },
    );
    const grim = mapProviderResult(
      {
        faces: parseDeepSeekAnswer(
          JSON.stringify({ faces: [{ ...FACE, smiling: false, smileConfidence: 95 }] }),
        ),
        latencyMs: 1,
        costMicros: 1,
      },
      { provider: "deepseek", providerModel: "m", cached: false },
    );

    expect(smiling.status).toBe("scored");
    expect(smiling.score).toBeGreaterThan(80);
    expect(grim.score).toBeLessThan(20);
  });
});

describe("classifyDeepSeekStatus", () => {
  it.each([
    [401, "fatal", "auth"],
    [403, "fatal", "auth"],
    [402, "fatal", "insufficient_balance"],
    [400, "fatal", "invalid_request"],
    [429, "retryable", "throttled"],
    [500, "retryable", "server_error"],
    [503, "retryable", "server_error"],
  ] as const)("HTTP %i is %s (%s)", (status, kind, code) => {
    expect(classifyDeepSeekStatus(status)).toMatchObject({ kind, code });
  });
});

describe("createDeepSeekProvider", () => {
  it("sends the image as a data URL with the key and the default model", async () => {
    const fetchMock = stubFetch(reply(JSON.stringify({ faces: [FACE] })));
    const provider = createDeepSeekProvider({ apiKey: "sk-test" });

    const result = await provider.score(input);

    expect(provider.model).toBe(DEEPSEEK_DEFAULT_MODEL);
    expect(result.costMicros).toBe(DEEPSEEK_COST_MICROS_PER_IMAGE);
    expect(result.faces).toHaveLength(1);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.deepseek.com/chat/completions");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer sk-test");
    const body = JSON.parse(String(init.body)) as {
      model: string;
      temperature: number;
      thinking: { type: string };
      max_tokens: number;
      messages: Array<{ content: Array<{ type: string; image_url?: { url: string } }> }>;
    };
    expect(body.model).toBe(DEEPSEEK_DEFAULT_MODEL);
    expect(body.temperature).toBe(0);
    expect(body.thinking).toEqual({ type: "disabled" });
    // A reply listing the full face cap must fit: ~45 tokens per face object.
    expect(body.max_tokens).toBe(DEEPSEEK_MAX_OUTPUT_TOKENS);
    expect(body.max_tokens).toBeGreaterThanOrEqual(50 * 45);
    const image = body.messages[0]?.content.find((part) => part.type === "image_url");
    expect(image?.image_url?.url).toMatch(/^data:image\/webp;base64,AQID$/);
  });

  it("honours a configured model and base URL", async () => {
    const fetchMock = stubFetch(reply(JSON.stringify({ faces: [] })));
    const provider = createDeepSeekProvider({
      apiKey: "k",
      model: "other",
      baseUrl: "https://proxy.example/v1/",
    });

    await provider.score(input);

    expect(provider.model).toBe("other");
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toBe("https://proxy.example/v1/chat/completions");
  });

  it("classifies an HTTP failure", async () => {
    stubFetch(new Response("{}", { status: 402 }));

    await expect(createDeepSeekProvider({ apiKey: "k" }).score(input)).rejects.toMatchObject({
      kind: "fatal",
      code: "insufficient_balance",
    });
  });

  it("reports an unreachable API as retryable", async () => {
    stubFetch(new TypeError("fetch failed"));

    await expect(createDeepSeekProvider({ apiKey: "k" }).score(input)).rejects.toMatchObject({
      kind: "retryable",
      code: "network_error",
    });
  });

  it("reports an aborted request as a retryable timeout", async () => {
    stubFetch(new DOMException("aborted", "AbortError"));
    const controller = new AbortController();
    controller.abort();

    await expect(
      createDeepSeekProvider({ apiKey: "k" }).score({ ...input, signal: controller.signal }),
    ).rejects.toMatchObject({ kind: "retryable", code: "timeout" });
  });

  it("rejects a reply without content", async () => {
    stubFetch(new Response(JSON.stringify({ choices: [] }), { status: 200 }));

    await expect(createDeepSeekProvider({ apiKey: "k" }).score(input)).rejects.toMatchObject({
      kind: "retryable",
      code: "bad_output",
    });
  });
});

describe("selection", () => {
  it("builds the provider from env and plans no fallback", () => {
    const provider = providerFor("deepseek", {
      SMILE_PROVIDER: "deepseek",
      DEEPSEEK_API_KEY: "k",
    });

    expect(provider.name).toBe("deepseek");
    expect(providerOrder({ SMILE_PROVIDER: "deepseek" })).toEqual(["deepseek"]);
  });

  it("refuses to build without a key", () => {
    expect(() => providerFor("deepseek", { SMILE_PROVIDER: "deepseek" })).toThrowError(
      /DEEPSEEK_API_KEY/,
    );
  });
});
