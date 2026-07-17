import { randomUUID } from "node:crypto";

export type ItemStatus = "active" | "archived";

export interface ItemBlueprint {
  readonly id: string;
  readonly name: string;
}

export interface Item {
  readonly id: string;
  readonly customerId: string;
  readonly name: string;
  readonly description: string;
  readonly project: { readonly id: string; readonly name: string };
  readonly blueprints: readonly ItemBlueprint[];
  readonly policy: { readonly id: string; readonly name: string };
  /** Regions shared by every selected Blueprint's current default Snapshot. */
  readonly regions: readonly { readonly id: string; readonly name: string }[];
  readonly defaultDurationMinutes: number;
  readonly status: ItemStatus;
  readonly archivedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface ItemRepository {
  save(item: Item): Promise<void>;
  findById(id: string): Promise<Item | null>;
  listByCustomerId(customerId: string): Promise<Item[]>;
}

export class ItemValidationError extends Error {
  constructor(message: string) { super(message); this.name = "ItemValidationError"; }
}

export class ItemNotFoundError extends Error {
  constructor() { super("Item was not found for this Customer."); this.name = "ItemNotFoundError"; }
}

export interface SaveItemInput {
  readonly customerId: string;
  readonly name: string;
  readonly description: string;
  readonly project: { readonly id: string; readonly name: string };
  readonly blueprints: readonly ItemBlueprint[];
  readonly policy: { readonly id: string; readonly name: string };
  readonly regions: readonly { readonly id: string; readonly name: string }[];
  readonly defaultDurationMinutes: number;
}

export function validateItemInput(input: SaveItemInput): void {
  if (!input.customerId.trim() || !input.name.trim()) throw new ItemValidationError("Items require a name.");
  if (!input.project.id.trim() || !input.policy.id.trim() || input.regions.length === 0 || input.regions.some((region) => !region.id.trim())) throw new ItemValidationError("Select a Project, Policy, and one or more eligible Regions from CloudShare.");
  if (new Set(input.regions.map((region) => region.id)).size !== input.regions.length) throw new ItemValidationError("A Region can only be selected once for an Item.");
  if (input.blueprints.length === 0 || input.blueprints.some((blueprint) => !blueprint.id.trim() || !blueprint.name.trim())) throw new ItemValidationError("Select one or more ordered Blueprints from CloudShare.");
  if (new Set(input.blueprints.map((blueprint) => blueprint.id)).size !== input.blueprints.length) throw new ItemValidationError("A Blueprint can only appear once in an Item.");
  if (!Number.isInteger(input.defaultDurationMinutes) || input.defaultDurationMinutes <= 0) throw new ItemValidationError("The selected Policy must provide a positive storage lease for the default duration.");
}

export async function createItem(deps: { readonly repository: ItemRepository; readonly now?: () => Date; readonly newId?: () => string }, input: SaveItemInput): Promise<Item> {
  validateItemInput(input);
  const now = (deps.now ?? (() => new Date()))();
  const item: Item = { ...input, id: (deps.newId ?? randomUUID)(), customerId: input.customerId.trim(), name: input.name.trim(), description: input.description.trim(), status: "active", archivedAt: null, createdAt: now, updatedAt: now };
  await deps.repository.save(item);
  return item;
}

export async function updateItem(deps: { readonly repository: ItemRepository; readonly now?: () => Date }, input: SaveItemInput & { readonly id: string }): Promise<Item> {
  validateItemInput(input);
  const existing = await deps.repository.findById(input.id);
  if (!existing || existing.customerId !== input.customerId) throw new ItemNotFoundError();
  const item: Item = { ...existing, ...input, customerId: input.customerId.trim(), name: input.name.trim(), description: input.description.trim(), updatedAt: (deps.now ?? (() => new Date()))() };
  await deps.repository.save(item);
  return item;
}

export async function archiveItem(deps: { readonly repository: ItemRepository; readonly now?: () => Date }, input: { readonly customerId: string; readonly id: string }): Promise<Item> {
  const existing = await deps.repository.findById(input.id);
  if (!existing || existing.customerId !== input.customerId) throw new ItemNotFoundError();
  const now = (deps.now ?? (() => new Date()))();
  const item: Item = { ...existing, status: "archived", archivedAt: now, updatedAt: now };
  await deps.repository.save(item);
  return item;
}
