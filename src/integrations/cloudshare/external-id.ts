export function toCloudShareExternalId(value: string): string {
  return value.replaceAll("-", "");
}
