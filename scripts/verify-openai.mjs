import { lstat, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

const MAX_SYNTHETIC_AUDIO_BYTES = 2 * 1024 * 1024;
const DEFAULT_URL = "http://127.0.0.1:3110";
const VERIFY_TIMEOUT_MS = 65_000;
const VERIFY_HEADER = "X-HomeRelay-OpenAI-Verify";

const HandoffDraftSchema = z
  .object({
    conditionSummary: z.string().trim().min(1).max(160),
    completedSummary: z.string().trim().max(160),
    nextRequest: z.string().trim().max(160),
    neededItems: z.array(z.string().trim().min(1).max(50)).max(5),
  })
  .strict();

const DraftResultSchema = z
  .object({
    mode: z.literal("live"),
    draft: HandoffDraftSchema,
  })
  .strict();

function assert(condition, code) {
  if (!condition) throw new Error(code);
}

export function verificationUrl(environment = process.env) {
  const raw = environment.HOMERELAY_OPENAI_VERIFY_URL?.trim() || DEFAULT_URL;
  const url = new URL(raw);
  const loopback =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "[::1]";

  assert(
    url.protocol === "http:" && loopback && !url.username && !url.password,
    "VERIFY_URL_UNSAFE",
  );
  assert(url.pathname === "/" && !url.search && !url.hash, "VERIFY_URL_INVALID");
  return new URL("/api/draft", url);
}

async function syntheticAudio(environment, { lstatImpl, readFileImpl }) {
  const configured = environment.HOMERELAY_OPENAI_VERIFY_AUDIO?.trim();
  assert(configured, "SYNTHETIC_AUDIO_REQUIRED");

  const path = resolve(configured);
  const stat = await lstatImpl(path);
  assert(stat.isFile() && !stat.isSymbolicLink(), "SYNTHETIC_AUDIO_UNSAFE");
  assert(
    stat.size > 0 && stat.size <= MAX_SYNTHETIC_AUDIO_BYTES,
    "SYNTHETIC_AUDIO_SIZE_INVALID",
  );
  assert(path.toLowerCase().endsWith(".wav"), "SYNTHETIC_AUDIO_FORMAT_INVALID");

  return readFileImpl(path);
}

export async function verifyOpenAI({
  abortSignalFactory = (milliseconds) => AbortSignal.timeout(milliseconds),
  environment = process.env,
  fetchImpl = fetch,
  lstatImpl = lstat,
  readFileImpl = readFile,
} = {}) {
  assert(
    environment.HOMERELAY_OPENAI_VERIFY?.trim().toLowerCase() === "true",
    "LIVE_VERIFY_NOT_ENABLED",
  );
  const verificationToken =
    environment.HOMERELAY_OPENAI_VERIFY_TOKEN?.trim() ?? "";
  assert(
    verificationToken.length >= 32 && !/[\r\n]/.test(verificationToken),
    "VERIFY_TOKEN_INVALID",
  );

  // Validate the destination before touching the local synthetic fixture.
  const endpoint = verificationUrl(environment);
  const audio = await syntheticAudio(environment, { lstatImpl, readFileImpl });
  const formData = new FormData();
  formData.set(
    "audio",
    new Blob([audio], { type: "audio/wav" }),
    "homerelay-synthetic-handoff.wav",
  );
  formData.set("durationMs", "6970");

  let response;
  try {
    response = await fetchImpl(endpoint, {
      body: formData,
      cache: "no-store",
      headers: { [VERIFY_HEADER]: verificationToken },
      method: "POST",
      redirect: "error",
      signal: abortSignalFactory(VERIFY_TIMEOUT_MS),
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    throw new Error(
      name === "AbortError" || name === "TimeoutError"
        ? "VERIFY_TIMEOUT"
        : "VERIFY_TRANSPORT_FAILED",
    );
  }

  if (response.status !== 200) {
    const safeClass = response.headers.get("x-homerelay-ai-error-class");
    const allowedClasses = new Set([
      "OPENAI_NOT_CONFIGURED",
      "OPENAI_TRANSCRIPTION_FAILED",
      "OPENAI_TRANSCRIPT_EMPTY",
      "OPENAI_DRAFT_FAILED",
      "OPENAI_DRAFT_EMPTY",
      "OPENAI_DRAFT_SCHEMA_INVALID",
    ]);
    throw new Error(
      allowedClasses.has(safeClass) ? safeClass : "DRAFT_ROUTE_REJECTED",
    );
  }
  assert(response.headers.get("cache-control") === "no-store", "CACHE_POLICY_INVALID");

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error("DRAFT_RESPONSE_JSON_INVALID");
  }

  const parsed = DraftResultSchema.safeParse(payload);
  assert(parsed.success, "DRAFT_RESPONSE_SCHEMA_INVALID");
  const result = parsed.data;
  const narrative = [
    result.draft.conditionSummary,
    result.draft.completedSummary,
    result.draft.nextRequest,
  ].join(" ");
  assert(/昼食/.test(narrative), "SYNTHETIC_LUNCH_MISSING");
  assert(/水分/.test(narrative), "SYNTHETIC_WATER_MISSING");
  assert(
    result.draft.neededItems.some((item) => /ティッシュ/.test(item)),
    "SYNTHETIC_TISSUE_MISSING",
  );
}

export async function runOpenAIVerifier({ logger = console, ...options } = {}) {
  try {
    await verifyOpenAI(options);
    logger.log(
      "[verify-openai] PASS: 合成音声のlive文字起こしとstrict構造化下書きを各1回確認しました（本文・認証情報は非表示）。",
    );
    return 0;
  } catch (error) {
    const safeCode =
      error instanceof Error && /^[A-Z_]+$/.test(error.message)
        ? error.message
        : "VERIFY_FAILED";
    logger.error(
      `[verify-openai] FAIL (${safeCode}): HomeRelayのOpenAI接続、合成音声、または構造化出力を確認してください（本文・認証情報は非表示）。`,
    );
    return 1;
  }
}

const isDirectExecution =
  Boolean(process.argv[1]) &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  process.exitCode = await runOpenAIVerifier();
}
