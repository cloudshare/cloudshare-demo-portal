/**
 * Compatibility adapter for older CloudShare call sites.
 *
 * Protected diagnostic body evidence is intentionally opaque: passphrase,
 * accessLink, loginUrl, token, and any analogous nested provider/request value
 * must reach the domain recorder unchanged. Request-header masking belongs to
 * the recorder's direction-aware seam, where the structure is known.
 */
export interface CloudShareDiagnosticRedactionOptions {
  readonly preserveSponsoredLinkLoginUrl?: boolean;
  readonly redactTokenLikeKeys?: boolean;
}

export function redactCloudShareAdminSupportValue(
  value: unknown,
  _options: CloudShareDiagnosticRedactionOptions = {},
): unknown {
  return value;
}
