export function buildWebhookCallbackUrl(
  publicBaseUrl: string,
  webhookPath: string | null | undefined,
): string | null {
  const trimmedBaseUrl = publicBaseUrl.trim().replace(/\/+$/, "");
  if (!trimmedBaseUrl || !webhookPath) {
    return null;
  }

  return `${trimmedBaseUrl}${webhookPath.startsWith("/") ? webhookPath : `/${webhookPath}`}`;
}
