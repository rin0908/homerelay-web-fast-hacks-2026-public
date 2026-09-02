import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { beforeAll, describe, expect, it, vi } from "vitest";

type VerifierModule = Readonly<{
  runOpenAIVerifier: (options?: Record<string, unknown>) => Promise<number>;
  verifyOpenAI: (options?: Record<string, unknown>) => Promise<void>;
}>;

const SYNTHETIC_RESULT = {
  mode: "live",
  draft: {
    conditionSummary: "昼食は半分ほど召し上がりました",
    completedSummary: "水分を用意しました",
    nextRequest: "次の方も水分をご確認ください",
    neededItems: ["ティッシュ"],
  },
};

let verifier: VerifierModule;
const VERIFY_TOKEN = "synthetic-openai-verifier-token-00000001";

beforeAll(async () => {
  const moduleUrl = pathToFileURL(
    resolve(process.cwd(), "scripts", "verify-openai.mjs"),
  ).href;
  verifier = (await import(/* @vite-ignore */ moduleUrl)) as VerifierModule;
});

function environment(overrides: Record<string, string> = {}) {
  return {
    HOMERELAY_OPENAI_VERIFY: "true",
    HOMERELAY_OPENAI_VERIFY_AUDIO: "synthetic-handoff.wav",
    ["HOMERELAY_OPENAI_VERIFY_TOKEN"]: VERIFY_TOKEN,
    HOMERELAY_OPENAI_VERIFY_URL: "http://127.0.0.1:3110",
    ...overrides,
  };
}

function fileDependencies(size = 128) {
  return {
    lstatImpl: vi.fn().mockResolvedValue({
      isFile: () => true,
      isSymbolicLink: () => false,
      size,
    }),
    readFileImpl: vi.fn().mockResolvedValue(Uint8Array.from([1, 2, 3])),
  };
}

function response(result: unknown = SYNTHETIC_RESULT) {
  return new Response(JSON.stringify(result), {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json",
    },
    status: 200,
  });
}

describe("OpenAI live verifier", () => {
  it("rejects a non-loopback destination before reading a fixture or fetching", async () => {
    const files = fileDependencies();
    const fetchImpl = vi.fn();

    await expect(
      verifier.verifyOpenAI({
        ...files,
        environment: environment({
          HOMERELAY_OPENAI_VERIFY_URL: "https://outside.example.test",
        }),
        fetchImpl,
      }),
    ).rejects.toThrow("VERIFY_URL_UNSAFE");

    expect(files.lstatImpl).not.toHaveBeenCalled();
    expect(files.readFileImpl).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects a short verifier token before reading or fetching", async () => {
    const files = fileDependencies();
    const fetchImpl = vi.fn();

    await expect(
      verifier.verifyOpenAI({
        ...files,
        environment: environment({ HOMERELAY_OPENAI_VERIFY_TOKEN: "short" }),
        fetchImpl,
      }),
    ).rejects.toThrow("VERIFY_TOKEN_INVALID");
    expect(files.lstatImpl).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sends one bounded loopback request and verifies every synthetic fact", async () => {
    const files = fileDependencies();
    const fetchImpl = vi.fn().mockResolvedValue(response());
    const abortSignal = new AbortController().signal;
    const abortSignalFactory = vi.fn(() => abortSignal);

    await expect(
      verifier.verifyOpenAI({
        ...files,
        abortSignalFactory,
        environment: environment(),
        fetchImpl,
      }),
    ).resolves.toBeUndefined();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [URL, RequestInit];
    expect(url.href).toBe("http://127.0.0.1:3110/api/draft");
    expect(init).toMatchObject({
      cache: "no-store",
      headers: { "X-HomeRelay-OpenAI-Verify": VERIFY_TOKEN },
      method: "POST",
      redirect: "error",
      signal: abortSignal,
    });
    expect(init.body).toBeInstanceOf(FormData);
    expect(abortSignalFactory).toHaveBeenCalledWith(65_000);
  });

  it.each([
    ["lunch", { ...SYNTHETIC_RESULT, draft: { ...SYNTHETIC_RESULT.draft, conditionSummary: "穏やかでした" } }, "SYNTHETIC_LUNCH_MISSING"],
    ["water", { ...SYNTHETIC_RESULT, draft: { ...SYNTHETIC_RESULT.draft, completedSummary: "お茶を用意しました", nextRequest: "次の方もご確認ください" } }, "SYNTHETIC_WATER_MISSING"],
    ["tissue", { ...SYNTHETIC_RESULT, draft: { ...SYNTHETIC_RESULT.draft, neededItems: ["手袋"] } }, "SYNTHETIC_TISSUE_MISSING"],
  ])("fails when the %s fact is absent", async (_label, result, code) => {
    await expect(
      verifier.verifyOpenAI({
        ...fileDependencies(),
        environment: environment(),
        fetchImpl: vi.fn().mockResolvedValue(response(result)),
      }),
    ).rejects.toThrow(code);
  });

  it.each([
    ["symlink", { isFile: () => true, isSymbolicLink: () => true, size: 128 }, "SYNTHETIC_AUDIO_UNSAFE"],
    ["oversize", { isFile: () => true, isSymbolicLink: () => false, size: 2 * 1024 * 1024 + 1 }, "SYNTHETIC_AUDIO_SIZE_INVALID"],
  ])("rejects an unsafe %s fixture without fetching", async (_label, stat, code) => {
    const fetchImpl = vi.fn();
    await expect(
      verifier.verifyOpenAI({
        environment: environment(),
        fetchImpl,
        lstatImpl: vi.fn().mockResolvedValue(stat),
        readFileImpl: vi.fn(),
      }),
    ).rejects.toThrow(code);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects a non-WAV fixture without reading or fetching it", async () => {
    const files = fileDependencies();
    const fetchImpl = vi.fn();

    await expect(
      verifier.verifyOpenAI({
        ...files,
        environment: environment({
          HOMERELAY_OPENAI_VERIFY_AUDIO: "synthetic-handoff.mp3",
        }),
        fetchImpl,
      }),
    ).rejects.toThrow("SYNTHETIC_AUDIO_FORMAT_INVALID");

    expect(files.readFileImpl).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects a success response whose cache policy is not exactly no-store", async () => {
    await expect(
      verifier.verifyOpenAI({
        ...fileDependencies(),
        environment: environment(),
        fetchImpl: vi.fn().mockResolvedValue(
          new Response(JSON.stringify(SYNTHETIC_RESULT), {
            headers: { "Cache-Control": "no-cache" },
            status: 200,
          }),
        ),
      }),
    ).rejects.toThrow("CACHE_POLICY_INVALID");
  });

  it("classifies invalid success JSON without printing its body", async () => {
    await expect(
      verifier.verifyOpenAI({
        ...fileDependencies(),
        environment: environment(),
        fetchImpl: vi.fn().mockResolvedValue(
          new Response("not-json", {
            headers: { "Cache-Control": "no-store" },
            status: 200,
          }),
        ),
      }),
    ).rejects.toThrow("DRAFT_RESPONSE_JSON_INVALID");
  });

  it.each([
    ["timeout", Object.assign(new Error("secret timeout detail"), { name: "TimeoutError" }), "VERIFY_TIMEOUT"],
    ["transport", new Error("secret transport detail"), "VERIFY_TRANSPORT_FAILED"],
  ])("classifies a %s failure without exposing the vendor detail", async (_label, failure, code) => {
    await expect(
      verifier.verifyOpenAI({
        ...fileDependencies(),
        environment: environment(),
        fetchImpl: vi.fn().mockRejectedValue(failure),
      }),
    ).rejects.toThrow(code);
  });

  it("classifies an invalid success schema without exposing fields", async () => {
    await expect(
      verifier.verifyOpenAI({
        ...fileDependencies(),
        environment: environment(),
        fetchImpl: vi.fn().mockResolvedValue(response({ mode: "live" })),
      }),
    ).rejects.toThrow("DRAFT_RESPONSE_SCHEMA_INVALID");
  });

  it("prints only a fixed safe failure without reading a vendor body", async () => {
    const secret = "OPENAI_SECRET_MUST_NOT_APPEAR";
    const bodyReader = vi.fn().mockResolvedValue({ detail: secret });
    const fetchImpl = vi.fn().mockResolvedValue({
      headers: new Headers({ "X-Vendor-Detail": secret }),
      json: bodyReader,
      status: 502,
    });
    const logger = { error: vi.fn(), log: vi.fn() };

    await expect(
      verifier.runOpenAIVerifier({
        ...fileDependencies(),
        environment: environment(),
        fetchImpl,
        logger,
      }),
    ).resolves.toBe(1);

    const output = [...logger.log.mock.calls, ...logger.error.mock.calls]
      .flat()
      .join(" ");
    expect(output).toContain("DRAFT_ROUTE_REJECTED");
    expect(output).not.toContain(secret);
    expect(bodyReader).not.toHaveBeenCalled();
  });
});
