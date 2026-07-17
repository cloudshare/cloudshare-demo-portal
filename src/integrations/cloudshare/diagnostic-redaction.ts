const REDACTED = "[REDACTED]";

const sponsoredLinkUrlPattern =
  /https?:\/\/\S*(?:ClassSponsoredLink|SponsoredLink|Ent\/Login)\S*/gi;

export interface CloudShareDiagnosticRedactionOptions {
  readonly preserveSponsoredLinkLoginUrl?: boolean;
  readonly redactTokenLikeKeys?: boolean;
}

function isAlwaysRedactedKey(
  key: string,
  options: CloudShareDiagnosticRedactionOptions,
): boolean {
  if (options.redactTokenLikeKeys) {
    return (
      /api[-_]?key/i.test(key) ||
      /passphrase/i.test(key) ||
      /webhook[-_]?secret/i.test(key) ||
      /secret/i.test(key) ||
      /password/i.test(key) ||
      /credential/i.test(key) ||
      /bearer/i.test(key) ||
      /signature/i.test(key) ||
      /hmac/i.test(key) ||
      /access[-_ ]?link/i.test(key) ||
      /(?:invitation|invite|sponsored)[-_ ]?(?:url|link)/i.test(key) ||
      /token/i.test(key) ||
      /^authorization$/i.test(key) ||
      /auth(?:orization)?[-_ ]?(?:header|token|secret|key|value)?$/i.test(key)
    );
  }

  return (
    /api[-_]?key/i.test(key) ||
    /passphrase/i.test(key) ||
    /webhook[-_]?secret/i.test(key) ||
    /secret/i.test(key) ||
    /password/i.test(key) ||
    /credential/i.test(key) ||
    /bearer/i.test(key) ||
    /signature/i.test(key) ||
    /hmac/i.test(key) ||
    /access[-_ ]?link/i.test(key) ||
    /(?:invitation|invite|sponsored)[-_ ]?(?:url|link)/i.test(key) ||
    /access[-_ ]?token/i.test(key) ||
    /auth(?:orization)?[-_ ]?(?:header|token|secret|key|value)$/i.test(key)
  );
}

function redactCloudShareAdminSupportText(
  value: string,
  options: CloudShareDiagnosticRedactionOptions,
): string {
  if (!options.preserveSponsoredLinkLoginUrl) {
    return value
      .replace(sponsoredLinkUrlPattern, REDACTED)
      .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+\b/gi, "Bearer [REDACTED]")
      .replace(/cs_sha1\s+userapiid:[^;]+;timestamp:[^;]+;token:[^;]+;hmac:[^\s"]+/gi, "cs_sha1 [REDACTED]")
      .replace(/([?&](?:token|access_token|loginUrl)=)[^&\s"]+/gi, "$1[REDACTED]");
  }

  const preservedUrls: string[] = [];
  const protectedValue = value.replace(sponsoredLinkUrlPattern, (match) => {
    const marker = `__PRESERVED_SPONSORED_LINK_${preservedUrls.length}__`;
    preservedUrls.push(match);
    return marker;
  });

  return protectedValue
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+\b/gi, "Bearer [REDACTED]")
    .replace(/cs_sha1\s+userapiid:[^;]+;timestamp:[^;]+;token:[^;]+;hmac:[^\s"]+/gi, "cs_sha1 [REDACTED]")
    .replace(/([?&](?:token|access_token|loginUrl)=)[^&\s"]+/gi, "$1[REDACTED]")
    .replace(/__PRESERVED_SPONSORED_LINK_(\d+)__/g, (_marker, index: string) => {
      return preservedUrls[Number(index)] ?? _marker;
    });
}

export function redactCloudShareAdminSupportValue(
  value: unknown,
  options: CloudShareDiagnosticRedactionOptions = {
    preserveSponsoredLinkLoginUrl: true,
  },
): unknown {
  if (typeof value === "string") {
    try {
      return redactCloudShareAdminSupportValue(JSON.parse(value), options);
    } catch {
      return redactCloudShareAdminSupportText(value, options);
    }
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactCloudShareAdminSupportValue(item, options));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const redacted: Record<string, unknown> = {};
  for (const [key, fieldValue] of Object.entries(value)) {
    if (isAlwaysRedactedKey(key, options)) {
      redacted[key] = REDACTED;
      continue;
    }

    if (/login[-_]?url/i.test(key) && !options.preserveSponsoredLinkLoginUrl) {
      redacted[key] = REDACTED;
      continue;
    }

    redacted[key] =
      typeof fieldValue === "string"
        ? redactCloudShareAdminSupportText(fieldValue, options)
        : redactCloudShareAdminSupportValue(fieldValue, options);
  }

  return redacted;
}
