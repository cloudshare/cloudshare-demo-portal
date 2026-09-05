import { getExpiredPortalLoginPath } from "@/auth/portal-return-target";

/** A one-shot client adapter: expiration never replays the failed operation. */
export function createPortalSessionExpiryRedirect(dependencies: {
  readonly currentPath: () => string;
  readonly fallbackLoginPath: string;
  readonly replace: (path: string) => void;
}): () => void {
  let redirecting = false;

  return () => {
    if (redirecting) return;
    redirecting = true;
    dependencies.replace(
      getExpiredPortalLoginPath(dependencies.currentPath())
      ?? dependencies.fallbackLoginPath,
    );
  };
}
