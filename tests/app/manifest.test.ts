import { describe, expect, it } from "vitest";

import manifest from "@/app/manifest";

describe("HomeRelay web app manifest", () => {
  it("launches as a scoped standalone HomeRelay app", () => {
    expect(manifest()).toMatchObject({
      background_color: "#faf8f3",
      display: "standalone",
      name: expect.stringContaining("HomeRelay"),
      scope: "/",
      short_name: "HomeRelay",
      start_url: "/",
      theme_color: "#faf8f3",
    });
  });
});
