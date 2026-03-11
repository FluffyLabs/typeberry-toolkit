import { describe, expect, it } from "vitest";
import { buildArtifactDownloadUrl } from "./artifact-url";

describe("buildArtifactDownloadUrl", () => {
  it("returns absolute URLs as-is", () => {
    const url = buildArtifactDownloadUrl("https://artifacts.example.com/artifacts/abc123");

    expect(url).toBe("https://artifacts.example.com/artifacts/abc123");
  });

  it("builds URL from base and artifact ID", () => {
    const url = buildArtifactDownloadUrl("abc123", "https://artifacts.example.com/");

    expect(url).toBe("https://artifacts.example.com/artifacts/abc123");
  });

  it("falls back to origin when base URL is missing", () => {
    const url = buildArtifactDownloadUrl("abc123", undefined, "http://localhost:5173");

    expect(url).toBe("http://localhost:5173/artifacts/abc123");
  });

  it("throws for empty artifact reference", () => {
    expect(() => buildArtifactDownloadUrl("   ", "https://artifacts.example.com")).toThrow(
      "Artifact reference is empty",
    );
  });

  it("throws when it cannot resolve base URL", () => {
    expect(() => buildArtifactDownloadUrl("abc123")).toThrow("Missing artifacts base URL");
  });
});
