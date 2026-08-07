import { describe, expect, it } from "vitest";

import defaultCapability from "../src-tauri/capabilities/default.json";

describe("default Tauri capability", () => {
  it("allows both stages of the guarded main-window close flow", () => {
    expect(defaultCapability.permissions).toContain("core:window:allow-close");
    expect(defaultCapability.permissions).toContain("core:window:allow-destroy");
    expect(defaultCapability.permissions).toContain("core:window:allow-hide");
  });
});
