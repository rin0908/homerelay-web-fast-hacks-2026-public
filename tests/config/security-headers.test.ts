import { describe, expect, it } from "vitest";

import nextConfig from "@/next.config";

describe("security headers", () => {
  it("protects private media capabilities and prevents framing", async () => {
    expect(nextConfig.headers).toBeTypeOf("function");
    const rules = await nextConfig.headers!();
    const catchAllRule = rules.find((rule) => rule.source === "/:path*");

    expect(catchAllRule).toBeDefined();
    const headers = Object.fromEntries(
      catchAllRule!.headers.map(({ key, value }) => [key, value]),
    );

    expect(headers).toEqual({
      "Content-Security-Policy": expect.any(String),
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Permissions-Policy":
        "camera=(self), microphone=(self), geolocation=()",
      "Referrer-Policy": "no-referrer",
      "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
    });
    expect(nextConfig.poweredByHeader).toBe(false);
    const contentSecurityPolicy = headers["Content-Security-Policy"];
    for (const directive of [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self'",
      "img-src 'self'",
      "media-src 'self' blob:",
      "connect-src 'self'",
      "font-src 'self' data:",
      "worker-src 'self' blob:",
      "manifest-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
    ]) {
      expect(contentSecurityPolicy).toContain(directive);
    }
  });
});
