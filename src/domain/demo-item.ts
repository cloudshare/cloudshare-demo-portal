import { randomUUID } from "node:crypto";

export type DemoItemStatus = "active" | "archived";
export type SalesExperienceType = "demo" | "poc" | "pov" | "trial";

export interface DemoItemBlueprint {
  readonly id: string;
  readonly name: string;
}

export interface DemoItem {
  readonly id: string;
  readonly customerId: string;
  readonly name: string;
  readonly description: string;
  readonly project: { readonly id: string; readonly name: string };
  readonly blueprints: readonly DemoItemBlueprint[];
  readonly policy: { readonly id: string; readonly name: string };
  readonly region: { readonly id: string; readonly name: string };
  readonly salesExperienceType: SalesExperienceType;
  readonly defaultDurationMinutes: number;
  readonly status: DemoItemStatus;
  readonly archivedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface DemoItemRepository {
  save(item: DemoItem): Promise<void>;
  findById(id: string): Promise<DemoItem | null>;
  listByCustomerId(customerId: string): Promise<DemoItem[]>;
}

export class DemoItemValidationError extends Error {
  constructor(message: string) { super(message); this.name = "DemoItemValidationError"; }
}

export class DemoItemNotFoundError extends Error {
  constructor() { super("Demo Item was not found for this Customer."); this.name = "DemoItemNotFoundError"; }
}

export interface SaveDemoItemInput {
  readonly customerId: string;
  readonly name: string;
  readonly description: string;
  readonly project: { readonly id: string; readonly name: string };
  readonly blueprints: readonly DemoItemBlueprint[];
  readonly policy: { readonly id: string; readonly name: string };
  readonly region: { readonly id: string; readonly name: string };
  readonly salesExperienceType: SalesExperienceType;
  readonly defaultDurationMinutes: number;
}

export function validateDemoItemInput(input: SaveDemoItemInput): void {
  if (!input.customerId.trim() || !input.name.trim()) throw new DemoItemValidationError("Demo Items require a name.");
  if (!input.project.id.trim() || !input.policy.id.trim() || !input.region.id.trim()) throw new DemoItemValidationError("Select a Project, Policy, and Region from CloudShare.");
  if (input.blueprints.length === 0 || input.blueprints.some((blueprint) => !blueprint.id.trim() || !blueprint.name.trim())) throw new DemoItemValidationError("Select one or more ordered Blueprints from CloudShare.");
  if (new Set(input.blueprints.map((blueprint) => blueprint.id)).size !== input.blueprints.length) throw new DemoItemValidationError("A Blueprint can only appear once in a Demo Item.");
  if (!Number.isInteger(input.defaultDurationMinutes) || input.defaultDurationMinutes <= 0) throw new DemoItemValidationError("The selected Policy must provide a positive storage lease for the default duration.");
  if (!["demo", "poc", "pov", "trial"].includes(input.salesExperienceType)) throw new DemoItemValidationError("Select Demo, POC, POV, or Trial as the Sales Experience type.");
}

export async function createDemoItem(deps: { readonly repository: DemoItemRepository; readonly now?: () => Date; readonly newId?: () => string }, input: SaveDemoItemInput): Promise<DemoItem> {
  validateDemoItemInput(input);
  const now = (deps.now ?? (() => new Date()))();
  const item: DemoItem = { ...input, id: (deps.newId ?? randomUUID)(), customerId: input.customerId.trim(), name: input.name.trim(), description: input.description.trim(), status: "active", archivedAt: null, createdAt: now, updatedAt: now };
  await deps.repository.save(item);
  return item;
}

export async function updateDemoItem(deps: { readonly repository: DemoItemRepository; readonly now?: () => Date }, input: SaveDemoItemInput & { readonly id: string }): Promise<DemoItem> {
  validateDemoItemInput(input);
  const existing = await deps.repository.findById(input.id);
  if (!existing || existing.customerId !== input.customerId) throw new DemoItemNotFoundError();
  const item: DemoItem = { ...existing, ...input, customerId: input.customerId.trim(), name: input.name.trim(), description: input.description.trim(), updatedAt: (deps.now ?? (() => new Date()))() };
  await deps.repository.save(item);
  return item;
}

export async function archiveDemoItem(deps: { readonly repository: DemoItemRepository; readonly now?: () => Date }, input: { readonly customerId: string; readonly id: string }): Promise<DemoItem> {
  const existing = await deps.repository.findById(input.id);
  if (!existing || existing.customerId !== input.customerId) throw new DemoItemNotFoundError();
  const now = (deps.now ?? (() => new Date()))();
  const item: DemoItem = { ...existing, status: "archived", archivedAt: now, updatedAt: now };
  await deps.repository.save(item);
  return item;
}
