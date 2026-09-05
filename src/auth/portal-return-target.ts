import type { PortalCustomerWorkspace, PortalUserRole } from "./portal-stores";

type PortalReturnScope = "certification_admin" | "sales_admin" | "candidate" | "sales_trial";

const PORTAL_ORIGIN = "https://portal.invalid";

const ALLOWED_QUERY_VALUES: Readonly<Record<PortalReturnScope, Readonly<Record<string, readonly string[] | "integer">>>> = {
  certification_admin: {
    tab: ["exams", "candidates", "support", "configuration"],
    view: ["catalog", "create", "edit", "sessions", "session", "monitoring", "diagnostics", "audit"],
  },
  sales_admin: {
    tab: ["items", "records", "sessions", "trial-offerings", "support", "configuration"],
    view: ["catalog", "create", "provision"],
    status: ["upcoming", "in_progress", "needs_attention", "ended"],
    queue: ["active", "needs_attention", "history"],
    sort: ["start_desc", "start_asc", "name_asc"],
    offset: "integer",
  },
  candidate: {},
  sales_trial: {},
};

function scopeForPath(pathname: string): PortalReturnScope | null {
  if (pathname === "/admin") return "certification_admin";
  if (pathname === "/sales") return "sales_admin";
  if (pathname === "/candidate") return "candidate";
  if (pathname === "/sales-trial") return "sales_trial";
  return null;
}

function hasOnlyQueryKeys(searchParams: URLSearchParams, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return [...searchParams.keys()].every((key) => allowed.has(key));
}

function hasValidRouteShape(scope: PortalReturnScope, searchParams: URLSearchParams): boolean {
  const tab = searchParams.get("tab");
  const view = searchParams.get("view");

  if (scope === "candidate" || scope === "sales_trial") return searchParams.size === 0;
  if (!tab) return searchParams.size === 0;

  if (scope === "certification_admin") {
    if (tab === "exams") {
      return hasOnlyQueryKeys(searchParams, ["tab", "view"])
        && (view === null || view === "catalog" || view === "create");
    }
    if (tab === "support") {
      return hasOnlyQueryKeys(searchParams, ["tab", "view"])
        && (view === null || view === "monitoring" || view === "diagnostics" || view === "audit");
    }
    return (tab === "candidates" || tab === "configuration")
      && hasOnlyQueryKeys(searchParams, ["tab"]);
  }

  if (tab === "items") {
    return hasOnlyQueryKeys(searchParams, ["tab", "view"])
      && (view === null || view === "catalog" || view === "create");
  }
  if (tab === "sessions") {
    return view === "provision"
      ? hasOnlyQueryKeys(searchParams, ["tab", "view"])
      : view === null && hasOnlyQueryKeys(searchParams, ["tab", "status", "queue", "sort", "offset"]);
  }
  return (tab === "records" || tab === "trial-offerings" || tab === "support" || tab === "configuration")
    && hasOnlyQueryKeys(searchParams, ["tab"]);
}

function safePortalTarget(raw: string | null | undefined): { readonly target: string; readonly scope: PortalReturnScope } | null {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || /[\u0000-\u001f\u007f]/.test(raw)) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(raw, PORTAL_ORIGIN);
  } catch {
    return null;
  }
  if (url.origin !== PORTAL_ORIGIN || url.hash) return null;

  const scope = scopeForPath(url.pathname);
  if (!scope) return null;
  const allowed = ALLOWED_QUERY_VALUES[scope];
  const seenKeys = new Set<string>();
  for (const [key, value] of url.searchParams) {
    const rule = allowed[key];
    if (seenKeys.has(key) || !rule || (rule === "integer" ? !/^(0|[1-9]\d*)$/.test(value) : !rule.includes(value))) {
      return null;
    }
    seenKeys.add(key);
  }
  if (!hasValidRouteShape(scope, url.searchParams)) return null;

  return { target: `${url.pathname}${url.search}`, scope };
}

function loginPathForScope(scope: PortalReturnScope): string {
  return scope === "sales_trial" ? "/sales-trial/login" : "/login";
}

function scopeForSession(session: Pick<{ role: PortalUserRole; workspace?: PortalCustomerWorkspace }, "role" | "workspace">): PortalReturnScope {
  if (session.role === "sales_trial_participant") return "sales_trial";
  if (session.role === "candidate") return "candidate";
  return session.workspace === "sales" ? "sales_admin" : "certification_admin";
}

function homeForScope(scope: PortalReturnScope): string {
  switch (scope) {
    case "sales_admin": return "/sales";
    case "candidate": return "/candidate";
    case "sales_trial": return "/sales-trial";
    default: return "/admin";
  }
}

/** Returns the role-specific login URL only for a safe, non-sensitive protected GET target. */
export function getExpiredPortalLoginPath(rawTarget: string | null | undefined): string | null {
  const safe = safePortalTarget(rawTarget);
  if (!safe) return null;
  return `${loginPathForScope(safe.scope)}?returnTo=${encodeURIComponent(safe.target)}`;
}

/** Validates a target before a login form retains it in its own same-origin request. */
export function getSafePortalReturnTarget(rawTarget: string | null | undefined): string | null {
  return safePortalTarget(rawTarget)?.target ?? null;
}

export function getSafePortalTargetFromSearchParams(
  pathname: string,
  searchParams: Record<string, string | string[] | undefined>,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (typeof value === "string") params.set(key, value);
    else if (Array.isArray(value)) return pathname;
  }
  return getSafePortalReturnTarget(`${pathname}${params.size ? `?${params}` : ""}`) ?? pathname;
}

/** Rechecks a previously supplied target after authentication; callers must navigate only to this result. */
export function getPortalReturnTargetForSession(
  session: Pick<{ role: PortalUserRole; workspace?: PortalCustomerWorkspace }, "role" | "workspace">,
  rawTarget: string | null | undefined,
): string {
  const expectedScope = scopeForSession(session);
  const safe = safePortalTarget(rawTarget);
  return safe?.scope === expectedScope ? safe.target : homeForScope(expectedScope);
}
