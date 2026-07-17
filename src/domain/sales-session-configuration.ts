import { DEFAULT_SALES_SESSION_NAME_TEMPLATE, renderSalesSessionName } from "./sales-session-name";

export interface SalesSessionConfigurationRepository { find(customerId: string): Promise<{ readonly template: string } | null>; save(customerId: string, template: string): Promise<void>; }
export function validateSalesSessionTemplate(template: string): string | null {
  return renderSalesSessionName(template, { account: "Account", opportunity: "Opportunity", revision: 9999, item: "Item" }) ? null : "Template must include {revision}, use supported placeholders, and render to at most 100 characters.";
}
export const defaultSalesSessionConfiguration = { template: DEFAULT_SALES_SESSION_NAME_TEMPLATE };
