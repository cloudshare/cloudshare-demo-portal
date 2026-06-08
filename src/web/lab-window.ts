/**
 * Opens the CloudShare lab in a child window and retains the handle, keyed by
 * ExamAttempt, so later slices can poll its liveness (e.g. heartbeat auto-suspend
 * when the candidate closes the lab). The window is opened WITHOUT `noopener` —
 * we deliberately keep the reference; that is the whole point of holding the handle.
 *
 * `opener` is injectable so the behaviour can be unit-tested without a real DOM.
 */

/** The slice of the `Window` API we rely on for liveness. */
export interface LabWindow {
  closed: boolean;
  close(): void;
  focus?(): void;
}

export type WindowOpener = (url: string, target: string) => LabWindow | null;

const handles = new Map<string, LabWindow>();

const defaultOpener: WindowOpener = (url, target) =>
  window.open(url, target) as LabWindow | null;

/**
 * Open `loginUrl` for `examAttemptId` in a named child window and retain its
 * handle. Throws if the window could not be opened (e.g. a blocked popup).
 */
export function openLabWindow(
  examAttemptId: string,
  loginUrl: string,
  opener: WindowOpener = defaultOpener,
): LabWindow {
  const handle = opener(loginUrl, `lab_${examAttemptId}`);
  if (!handle) {
    throw new Error(`Lab window for "${examAttemptId}" could not be opened (popup blocked?)`);
  }
  handles.set(examAttemptId, handle);
  return handle;
}

/** The retained handle for an attempt's lab window, if one was opened. */
export function getLabWindow(examAttemptId: string): LabWindow | undefined {
  return handles.get(examAttemptId);
}

/** Whether the attempt's lab window is currently open (handle exists and not closed). */
export function isLabWindowOpen(examAttemptId: string): boolean {
  const handle = handles.get(examAttemptId);
  return handle !== undefined && !handle.closed;
}
