export class TransientVendorReadbackError extends Error {
  constructor(code: string) {
    super(`Hosted E2E transient read-back failure: ${code}`);
    this.name = "TransientVendorReadbackError";
  }
}

export async function readVendorJson(
  response: Pick<Response, "json">,
  failureCode: string,
): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new TransientVendorReadbackError(failureCode);
  }
}
