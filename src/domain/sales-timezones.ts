import { isSalesExperienceType, type SalesExperienceType } from "./sales-experience-type";

export interface SalesTimezone { readonly id: string; readonly name: string; }
export interface SalesTimezoneCacheEntry { readonly customerId: string; readonly timezones: readonly SalesTimezone[]; readonly fetchedAt: Date; }
export interface SalesTimezoneCacheRepository { find(customerId: string): Promise<SalesTimezoneCacheEntry | null>; save(entry: SalesTimezoneCacheEntry): Promise<void>; }
export interface SalesAdminPreference { readonly timeZone: string | null; readonly experienceType: SalesExperienceType | null; }
export interface SalesAdminPreferenceRepository { find(userId: string): Promise<SalesAdminPreference>; save(userId: string, preference: SalesAdminPreference): Promise<void>; }

export const SALES_TIMEZONE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export function isSalesTimezoneCacheFresh(entry: SalesTimezoneCacheEntry, now: Date): boolean { return now.getTime() - entry.fetchedAt.getTime() < SALES_TIMEZONE_CACHE_TTL_MS; }
export { isSalesExperienceType };
