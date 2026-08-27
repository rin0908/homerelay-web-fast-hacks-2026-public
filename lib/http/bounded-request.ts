import "server-only";

export type BoundedRequestResult =
  | Readonly<{ byteLength: number; request: Request; status: "ok" }>
  | Readonly<{ status: "malformed" }>
  | Readonly<{ status: "too_large" }>;

type DeclaredLength =
  | Readonly<{ status: "missing" }>
  | Readonly<{ status: "malformed" }>
  | Readonly<{ status: "valid"; value: number }>;

function parseDeclaredLength(request: Request): DeclaredLength {
  const raw = request.headers.get("content-length");
  if (raw === null) return { status: "missing" };

  const normalized = raw.trim();
  if (!/^\d+$/.test(normalized)) return { status: "malformed" };

  const value = Number(normalized);
  if (!Number.isSafeInteger(value)) return { status: "malformed" };
  if (request.headers.has("transfer-encoding")) return { status: "malformed" };
  return { status: "valid", value };
}

async function cancelStream(stream: ReadableStream<Uint8Array> | null) {
  if (!stream) return;
  try {
    await stream.cancel();
  } catch {
    // A locked or already errored request is still treated as malformed.
  }
}

async function cancelReader(
  reader: ReadableStreamDefaultReader<Uint8Array>,
) {
  try {
    await reader.cancel();
  } catch {
    // Cancellation is best effort after the request has already been rejected.
  }
}

function combineChunks(
  chunks: readonly Uint8Array[],
  byteLength: number,
): Uint8Array<ArrayBuffer> {
  const body = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function isByteChunk(value: unknown): value is Uint8Array {
  return (
    ArrayBuffer.isView(value) &&
    "BYTES_PER_ELEMENT" in value &&
    value.BYTES_PER_ELEMENT === 1
  );
}

function reconstructRequest(
  original: Request,
  body: Uint8Array<ArrayBuffer>,
): Request | null {
  try {
    const headers = new Headers();
    const contentType = original.headers.get("content-type");
    if (contentType) headers.set("content-type", contentType);

    return new Request(original.url, {
      body,
      headers,
      method: original.method,
    });
  } catch {
    return null;
  }
}

/**
 * Reads a Route Handler request without trusting Content-Length. The returned
 * Request contains only the bounded body and its Content-Type, so native
 * `json()` / `formData()` parsing cannot consume the original stream again.
 */
export async function readBoundedRequest(
  request: Request,
  maximumBytes: number,
): Promise<BoundedRequestResult> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0) {
    throw new RangeError("maximumBytes must be a non-negative safe integer");
  }

  const declaredLength = parseDeclaredLength(request);
  if (declaredLength.status === "malformed") {
    await cancelStream(request.body);
    return { status: "malformed" };
  }
  if (
    declaredLength.status === "valid" &&
    declaredLength.value > maximumBytes
  ) {
    await cancelStream(request.body);
    return { status: "too_large" };
  }

  if (!request.body) {
    if (
      declaredLength.status === "valid" &&
      declaredLength.value !== 0
    ) {
      return { status: "malformed" };
    }
    const bounded = reconstructRequest(request, new Uint8Array());
    return bounded
      ? { byteLength: 0, request: bounded, status: "ok" }
      : { status: "malformed" };
  }

  const chunks: Uint8Array[] = [];
  const reader = request.body.getReader();
  let byteLength = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!isByteChunk(value)) {
        await cancelReader(reader);
        return { status: "malformed" };
      }

      byteLength += value.byteLength;
      if (byteLength > maximumBytes) {
        await cancelReader(reader);
        return { status: "too_large" };
      }
      chunks.push(value);
    }
  } catch {
    await cancelReader(reader);
    return { status: "malformed" };
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // The result above already rejects unusable request streams safely.
    }
  }

  if (
    declaredLength.status === "valid" &&
    declaredLength.value !== byteLength
  ) {
    return { status: "malformed" };
  }

  const bounded = reconstructRequest(
    request,
    combineChunks(chunks, byteLength),
  );
  return bounded
    ? { byteLength, request: bounded, status: "ok" }
    : { status: "malformed" };
}
