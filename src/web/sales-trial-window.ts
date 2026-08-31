export interface SalesTrialWindow {
  closed: boolean;
  close(): void;
  focus?(): void;
}

export type SalesTrialWindowOpener = (
  url: string,
  target: string,
) => SalesTrialWindow | null;

const handles = new Map<string, SalesTrialWindow>();

const defaultOpener: SalesTrialWindowOpener = (url, target) =>
  window.open(url, target) as SalesTrialWindow | null;

export function buildSalesTrialEnterUrl(offeringId: string): string {
  return `/sales-trial/offerings/${encodeURIComponent(offeringId)}/enter`;
}

export function openSalesTrialWindow(
  offeringId: string,
  opener: SalesTrialWindowOpener = defaultOpener,
): {
  readonly handle: SalesTrialWindow;
  readonly reused: boolean;
} {
  const current = handles.get(offeringId);
  if (current && !current.closed) {
    current.focus?.();
    return { handle: current, reused: true };
  }

  const handle = opener(
    buildSalesTrialEnterUrl(offeringId),
    `sales_trial_${offeringId}`,
  );
  if (!handle) {
    throw new Error("Sales Trial window could not be opened (popup blocked?)");
  }
  handles.set(offeringId, handle);
  return { handle, reused: false };
}

export function clearSalesTrialWindows(): void {
  handles.clear();
}

export function readSalesTrialEnterBlockedMessage(
  event: MessageEvent,
  context: {
    readonly expectedOrigin: string;
    readonly offeringId: string;
  },
): { readonly status: number; readonly message: string } | null {
  if (event.origin !== context.expectedOrigin) {
    return null;
  }
  const payload = event.data as {
    type?: unknown;
    offeringId?: unknown;
    status?: unknown;
    message?: unknown;
  };
  if (
    payload?.type !== "certalis:sales-trial-entry-blocked" ||
    payload.offeringId !== context.offeringId ||
    typeof payload.status !== "number" ||
    typeof payload.message !== "string"
  ) {
    return null;
  }
  return { status: payload.status, message: payload.message };
}
