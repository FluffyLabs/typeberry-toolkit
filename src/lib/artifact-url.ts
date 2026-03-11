const HTTP_URL_PATTERN = /^https?:\/\//i;

export function buildArtifactDownloadUrl(artifactRef: string, baseUrl?: string, fallbackOrigin?: string): string {
  const normalizedArtifactRef = artifactRef.trim();
  if (!normalizedArtifactRef) {
    throw new Error("Artifact reference is empty");
  }

  if (HTTP_URL_PATTERN.test(normalizedArtifactRef)) {
    return normalizedArtifactRef;
  }

  const normalizedBaseUrl = (baseUrl?.trim() || fallbackOrigin?.trim() || "").replace(/\/+$/, "");
  if (!normalizedBaseUrl) {
    throw new Error("Missing artifacts base URL");
  }

  return `${normalizedBaseUrl}/artifacts/${encodeURIComponent(normalizedArtifactRef)}`;
}
