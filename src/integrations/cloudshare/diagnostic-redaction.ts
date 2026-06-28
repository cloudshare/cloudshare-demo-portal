const REDACTED = "[REDACTED]";

const sponsoredLinkUrlPattern =
  /https?:\/\/\S*(?:ClassSponsoredLink|SponsoredLink|Ent\/Login)\S*/gi;

function redactCloudShareAdminSupportText(value: string): string {
  const preservedUrls: string[] = [];
  const protectedValue = value.replace(sponsoredLinkUrlPattern, (match) => {
    const marker = `__PRESERVED_SPONSORED_LINK_${preservedUrls.length}__`;
    preservedUrls.push(match);
    return marker;
  });

  return protectedValue
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+\b/gi, "Bearer [REDACTED]")
    .replace(
      /cs_sha1\s+userapiid:[^;]+;timestamp:[^;]+;token:[^;]+;hmac:[^\s"]+/gi,
      (match) => match.replace(/token:[^;]+/i, "token:[REDACTED]").replace(/hmac:[^\s"]+/i, "hmac:[REDACTED]"),
    )
    .replace(/([?&](?:token|access_token|loginUrl)=)[^&\s"]+/gi, "$1[REDACTED]")
    .replace(/__PRESERVED_SPONSORED_LINK_(\d+)__/g, (_marker, index: string) => {
      return preservedUrls[Number(index)] ?? _marker;
    });
}

export function redactCloudShareAdminSupportValue(value: unknown): unknown {
  if (typeof value === "string") {
    try {
      return redactCloudShareAdminSupportValue(JSON.parse(value));
    } catch {
      return redactCloudShareAdminSupportText(value);
    }
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactCloudShareAdminSupportValue(item));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const redacted: Record<string, unknown> = {};
  for (const [key, fieldValue] of Object.entries(value)) {
    if (/api[-_]?key|secret|token|hmac|signature|password|authorization|credential/i.test(key)) {
      redacted[key] = REDACTED;
      continue;
    }

    redacted[key] =
      typeof fieldValue === "string"
        ? redactCloudShareAdminSupportText(fieldValue)
        : redactCloudShareAdminSupportValue(fieldValue);
  }

  return redacted;
}
