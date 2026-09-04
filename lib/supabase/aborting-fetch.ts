const SUPABASE_NETWORK_TIMEOUT_MS = 15_000;

function keepDeadlineThroughBody(
  response: Response,
  finish: () => void,
): Response {
  if (!response.body) {
    finish();
    return response;
  }

  // fetch() resolves after headers, before response.json()/text() consumes the
  // body. The current Supabase JS/Auth SDK consumes these responses via
  // response.json(), so keep the same AbortSignal alive through that read
  // instead of clearing the deadline at headers. A future caller that reads
  // response.body directly, or consumes a response.clone() stream, retains the
  // same intentional 15-second deadline and may be aborted; this wrapper is
  // not an unlimited streaming transport.
  return new Proxy(response, {
    get(target, property) {
      if (property === "json") {
        return async () => {
          try {
            return await target.json();
          } finally {
            finish();
          }
        };
      }
      if (property === "text") {
        return async () => {
          try {
            return await target.text();
          } finally {
            finish();
          }
        };
      }
      if (property === "arrayBuffer") {
        return async () => {
          try {
            return await target.arrayBuffer();
          } finally {
            finish();
          }
        };
      }
      if (property === "blob") {
        return async () => {
          try {
            return await target.blob();
          } finally {
            finish();
          }
        };
      }
      if (property === "formData") {
        return async () => {
          try {
            return await target.formData();
          } finally {
            finish();
          }
        };
      }

      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

export function createSupabaseAbortingFetch(): typeof fetch {
  return async (input, init) => {
    const controller = new AbortController();
    const upstreamSignal =
      init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const relayAbort = () => controller.abort();

    if (upstreamSignal?.aborted) {
      relayAbort();
    } else {
      upstreamSignal?.addEventListener("abort", relayAbort, { once: true });
    }

    let finished = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      if (finished) return;
      finished = true;
      if (timer) clearTimeout(timer);
      timer = undefined;
      upstreamSignal?.removeEventListener("abort", relayAbort);
    };
    timer = setTimeout(() => {
      controller.abort();
      finish();
    }, SUPABASE_NETWORK_TIMEOUT_MS);

    try {
      // Abort the underlying request itself. A detached Promise.race could
      // return while a late Auth response still writes browser cookies.
      const response = await globalThis.fetch(input, {
        ...init,
        signal: controller.signal,
      });
      return keepDeadlineThroughBody(response, finish);
    } catch (error) {
      finish();
      throw error;
    }
  };
}
