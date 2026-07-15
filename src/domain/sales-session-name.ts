export const DEFAULT_SALES_SESSION_NAME_TEMPLATE = "{account} - {opportunity} ({revision}) - {item}";

export function renderSalesSessionName(template: string, values: { readonly account: string; readonly opportunity: string; readonly revision: number; readonly item: string }): string | null {
  if (template.length > 160 || !template.includes("{revision}")) return null;
  const rendered = template.replaceAll("{account}", values.account).replaceAll("{opportunity}", values.opportunity).replaceAll("{revision}", String(values.revision)).replaceAll("{item}", values.item).trim();
  return rendered.length > 0 && rendered.length <= 100 ? rendered : null;
}
