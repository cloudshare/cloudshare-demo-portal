"use client";

import React, { type CSSProperties, useState } from "react";
import { SalesTrialRdp } from "./sales-trial-rdp";
import { useRouter } from "next/navigation";
import {
  accountLogoutButtonStyle,
  disabledButtonStyle,
  primaryButtonStyle,
} from "./button-styles";
import { alertPanelStyle, cardStyle } from "./card-styles";
import { colors, pageHeadingStyle, spacing } from "./design-tokens";
import { openSalesTrialWindow, readSalesTrialEnterBlockedMessage } from "./sales-trial-window";
import { createPortalSessionExpiryRedirect } from "./portal-session-redirect";
import { startPortalSessionWatchdog } from "./session-expiry";

type TrialOffering = {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly start: string;
  readonly end: string | null;
  readonly timeZone: string;
};

const EMPTY_TRIAL_OFFERINGS: readonly TrialOffering[] = [];

interface SalesTrialHomeProps {
  readonly email: string;
  readonly firstName?: string | null;
  readonly fetchImpl?: typeof fetch;
  readonly openTrialWindow?: (
    offeringId: string,
  ) => { readonly reused: boolean };
  readonly initialOfferings?: readonly TrialOffering[];
}

export function SalesTrialHome({
  email,
  firstName,
  fetchImpl = fetch,
  openTrialWindow = (offeringId) => openSalesTrialWindow(offeringId),
  initialOfferings = EMPTY_TRIAL_OFFERINGS,
}: SalesTrialHomeProps) {
  const router = useRouter();
  const hasInitialOfferings = initialOfferings.length > 0;
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [offerings, setOfferings] = useState<TrialOffering[]>([...initialOfferings]);
  const [offeringError, setOfferingError] = useState<string | null>(null);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [openOfferingId, setOpenOfferingId] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const sessionExpiryRedirect = React.useRef<(() => void) | null>(null);
  if (!sessionExpiryRedirect.current) {
    sessionExpiryRedirect.current = createPortalSessionExpiryRedirect({
      currentPath: () => `${window.location.pathname}${window.location.search}`,
      fallbackLoginPath: "/sales-trial/login",
      replace: (path) => {
        setSessionExpired(true);
        router.replace(path);
      },
    });
  }
  const handleSessionExpired = sessionExpiryRedirect.current;
  React.useEffect(() => { if (sessionExpired) return; const watchdog = startPortalSessionWatchdog({ fetchImpl, onExpired: handleSessionExpired }); void watchdog.checkNow(); return () => watchdog.stop(); }, [fetchImpl, handleSessionExpired, sessionExpired]);

  React.useEffect(() => {
    if (hasInitialOfferings) {
      return;
    }
    void fetchImpl("/api/sales-trial/offerings", { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json()) as { offerings?: TrialOffering[]; error?: string };
        if (response.status === 401) {
          handleSessionExpired();
          return { offerings: [] };
        }
        if (!response.ok) {
          throw new Error(body.error ?? "Could not load Trial Offerings.");
        }
        setOfferings(body.offerings ?? []);
      })
      .catch((error) => {
        setOfferingError(
          error instanceof Error ? error.message : "Could not load Trial Offerings.",
        );
        setOfferings([]);
      });
  }, [fetchImpl, handleSessionExpired, hasInitialOfferings]);

  React.useEffect(() => {
    function handleMessage(event: MessageEvent) {
      const blocked = readSalesTrialEnterBlockedMessage(event, {
        expectedOrigin: window.location.origin,
        offeringId: openOfferingId ?? "",
      });
      if (!blocked) {
        return;
      }
      if (blocked.status === 401) {
        handleSessionExpired();
        return;
      }
      setLaunchError(blocked.message);
      setOpenOfferingId(null);
    }

    window.addEventListener("message", handleMessage);
    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, [handleSessionExpired, openOfferingId]);

  async function signOut(): Promise<void> {
    if (loggingOut) return;
    setLoggingOut(true);
    setLogoutError(null);
    try {
      const response = await fetchImpl("/api/auth/logout", { method: "POST" });
      if (response.status === 401) {
        setSessionExpired(false);
        router.replace("/sales-trial/login");
        router.refresh();
        return;
      }
      if (!response.ok) throw new Error(`Logout failed (${response.status})`);
      router.replace("/sales-trial/login");
      router.refresh();
    } catch {
      setLogoutError("Sign out failed. Try again.");
      setLoggingOut(false);
    }
  }

  function launch(offeringId: string): void {
    setLaunchError(null);
    try {
      const result = openTrialWindow(offeringId);
      setOpenOfferingId(offeringId);
      if (result.reused) {
        return;
      }
    } catch {
      setLaunchError("Trial window could not be opened. Allow popups for this site and try again.");
    }
  }

  if (sessionExpired) {
    return <main aria-live="polite" style={pageStyle}>Continuing to sign in…</main>;
  }

  return (
    <main style={pageStyle}>
      <style>{salesTrialHomeStyles}</style>
      <section style={pageContentStyle}>
        <section style={heroStyle}>
          <div style={{ display: "grid", gap: spacing.sm }}>
            <p style={heroEyebrowStyle}>Certalis Sales Trial</p>
            <h1 style={heroHeadingStyle}>
              {firstName ? `Welcome, ${firstName}.` : "Welcome."}
            </h1>
            <p style={heroCopyStyle}>
              Your Sales Trial sign-in is active for <strong>{email}</strong>. Open a trial window
              from the active catalogue below, or review the trial details before you launch.
            </p>
          </div>
        </section>
        {launchError ? <div role="alert" style={alertPanelStyle.danger}>{launchError}</div> : null}
        {offerings.length === 0 ? (
          <section style={{ ...cardStyle, display: "grid", gap: spacing.sm }}>
            <h2 style={{ margin: 0 }}>No active Trial Offerings</h2>
            <p style={{ color: colors.textSecondary, margin: 0 }}>
              There are no active Trial Offerings right now.
            </p>
          </section>
        ) : (
          <section style={{ display: "grid", gap: spacing.md }}>
            <div style={sectionHeaderStyle}>
              <div>
                <p style={sectionEyebrowStyle}>Active catalogue</p>
                <h2 style={{ margin: "0.25rem 0 0" }}>Choose a Trial Offering</h2>
              </div>
              <p style={sectionCopyStyle}>
                {offerings.length} active {offerings.length === 1 ? "window" : "windows"}
              </p>
            </div>
            <div style={offeringGridStyle}>
              {offerings.map((offering) => (
                <SalesTrialOfferingCard
                  key={offering.id}
                  offering={offering}
                  active={openOfferingId === offering.id}
                  onLaunch={() => launch(offering.id)}
                  fetchImpl={fetchImpl}
                />
              ))}
            </div>
          </section>
        )}
        {offeringError ? (
          <p role="status" style={{ color: colors.danger, marginBottom: 0 }}>
            {offeringError}
          </p>
        ) : null}
        <button
          type="button"
          onClick={() => void signOut()}
          disabled={loggingOut}
          style={
            loggingOut
              ? { ...accountLogoutButtonStyle, ...disabledButtonStyle }
              : accountLogoutButtonStyle
          }
        >
          {loggingOut ? "Signing out..." : "Sign out"}
        </button>
        {logoutError ? (
          <p role="status" style={{ color: colors.danger, marginBottom: 0 }}>
            {logoutError}
          </p>
        ) : null}
      </section>
    </main>
  );
}

function SalesTrialOfferingCard({
  offering,
  active,
  onLaunch,
  fetchImpl,
}: {
  readonly offering: TrialOffering;
  readonly active: boolean;
  readonly onLaunch: () => void;
  readonly fetchImpl: typeof fetch;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const windowLabel = offering.end
    ? `${offering.start} to ${offering.end} (${offering.timeZone})`
    : `${offering.start} onward (${offering.timeZone})`;
  const frontFaceTabIndex = showDetails ? -1 : 0;
  const backFaceTabIndex = showDetails ? 0 : -1;

  return (
    <article
      className="sales-trial-offering-card"
      style={offeringCardStyle}
    >
      <div style={flipPerspectiveStyle}>
        <div
          className="sales-trial-offering-card__inner"
          data-show-details={showDetails ? "true" : "false"}
          style={flipInnerStyle}
        >
          <section
            aria-hidden={showDetails}
            className="sales-trial-offering-card__face sales-trial-offering-card__face--front"
            style={flipFaceStyle}
          >
            <div style={offeringFaceContentStyle}>
              <div style={cardAccentStyle} />
              <div style={{ display: "grid", gap: spacing.sm }}>
                <div style={cardTitleRowStyle}>
                  <h3 style={{ margin: 0, fontSize: "1.3rem", color: colors.textPrimary }}>{offering.title}</h3>
                  <span style={availabilityBadgeStyle}>{active ? "Window open" : "Ready to launch"}</span>
                </div>
                <p style={bodyCopyStyle}>{offering.description || "No description provided."}</p>
              </div>
              <div style={summaryPanelStyle}>
                <span style={summaryEyebrowStyle}>Trial window</span>
                <strong style={summaryValueStyle}>{windowLabel}</strong>
              </div>
              <button type="button" tabIndex={frontFaceTabIndex} onClick={onLaunch} style={primaryButtonStyle}>
                {active ? "Focus trial window" : "Open trial window"}
              </button>
              <div style={cardFooterStyle}>
                <button type="button" tabIndex={frontFaceTabIndex} onClick={() => setShowDetails(true)} style={cardSecondaryButtonStyle}>
                  Trial details
                </button>
              </div>
            </div>
          </section>
          <section
            aria-hidden={!showDetails}
            className="sales-trial-offering-card__face sales-trial-offering-card__face--back"
            style={flipFaceStyle}
          >
            <div style={offeringFaceContentStyle}>
              <div style={cardAccentStyle} />
              <div style={{ display: "grid", gap: spacing.sm }}>
                <span style={summaryEyebrowStyle}>Trial details</span>
                <h3 style={{ margin: 0, fontSize: "1.3rem", color: colors.textPrimary }}>{offering.title}</h3>
                <p style={bodyCopyStyle}>{offering.description || "No description provided."}</p>
              </div>
              <div style={detailsGridStyle}>
                <div style={detailPanelStyle}>
                  <span style={detailLabelStyle}>Window</span>
                  <span style={detailValueStyle}>{windowLabel}</span>
                </div>
                <div style={detailPanelStyle}>
                  <span style={detailLabelStyle}>Access path</span>
                  <span style={detailValueStyle}>
                    Portal launch opens the CloudShare trial window in a separate tab.
                  </span>
                </div>
              </div>
              <SalesTrialRdp offeringId={offering.id} active={showDetails} fetchImpl={fetchImpl} />
              <button type="button" tabIndex={backFaceTabIndex} onClick={onLaunch} style={primaryButtonStyle}>
                {active ? "Focus trial window" : "Open trial window"}
              </button>
              <div style={cardFooterStyle}>
                <button type="button" tabIndex={backFaceTabIndex} onClick={() => setShowDetails(false)} style={cardSecondaryButtonStyle}>
                  Back to trial
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>
    </article>
  );
}

const pageStyle: CSSProperties = {
  minHeight: "100vh",
  padding: spacing.xl,
  background: "linear-gradient(180deg, #eef6ff 0%, #f8fafc 34%, #ffffff 100%)",
};

const pageContentStyle: CSSProperties = {
  width: "100%",
  maxWidth: "1180px",
  margin: "0 auto",
  display: "grid",
  gap: spacing.lg,
};

const heroStyle: CSSProperties = {
  ...cardStyle,
  display: "grid",
  gap: spacing.md,
  padding: spacing.xxl,
  background: "linear-gradient(135deg, #ffffff 0%, #f0fdf9 52%, #eff6ff 100%)",
  border: `1px solid ${colors.borderStrong}`,
  boxShadow: "0 16px 40px rgba(15, 23, 42, 0.08)",
};

const heroEyebrowStyle: CSSProperties = {
  margin: 0,
  color: colors.accent,
  fontSize: "0.82rem",
  fontWeight: 800,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
};

const heroCopyStyle: CSSProperties = {
  margin: 0,
  color: colors.textSecondary,
  maxWidth: "48rem",
  lineHeight: 1.6,
};

const heroHeadingStyle: CSSProperties = {
  ...pageHeadingStyle,
  margin: 0,
  fontSize: "3rem",
};

const sectionHeaderStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: spacing.md,
  alignItems: "end",
  flexWrap: "wrap",
};

const sectionEyebrowStyle: CSSProperties = {
  margin: 0,
  color: colors.accent,
  fontSize: "0.8rem",
  fontWeight: 800,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
};

const sectionCopyStyle: CSSProperties = {
  margin: 0,
  color: colors.textSecondary,
};

const offeringGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 18rem), 1fr))",
  gap: spacing.md,
  alignItems: "stretch",
};

const offeringCardStyle: CSSProperties = {
  ...cardStyle,
  padding: 0,
  minHeight: "27rem",
  border: `1px solid ${colors.border}`,
  boxShadow: "0 8px 24px rgba(15, 23, 42, 0.08)",
};

const flipPerspectiveStyle: CSSProperties = {
  perspective: "1200px",
  minHeight: "27rem",
};

const flipInnerStyle: CSSProperties = {
  display: "grid",
  position: "relative",
  minHeight: "27rem",
};

const flipFaceStyle: CSSProperties = {
  gridArea: "1 / 1",
  minWidth: 0,
};

const offeringFaceContentStyle: CSSProperties = {
  display: "grid",
  gap: spacing.md,
  gridTemplateRows: "auto auto minmax(0, 1fr) auto",
  alignContent: "start",
  padding: spacing.lg,
  boxSizing: "border-box",
};

const cardAccentStyle: CSSProperties = {
  height: "4px",
  borderRadius: "999px",
  background: "linear-gradient(90deg, #4f46e5 0%, #0f6d66 54%, #f97316 100%)",
};

const cardTitleRowStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: spacing.sm,
  alignItems: "start",
  flexWrap: "wrap",
};

const availabilityBadgeStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "0.35rem 0.7rem",
  borderRadius: "999px",
  background: colors.infoSoft,
  color: colors.info,
  fontSize: "0.82rem",
  fontWeight: 700,
};

const bodyCopyStyle: CSSProperties = {
  margin: 0,
  color: colors.textSecondary,
  lineHeight: 1.55,
};

const summaryPanelStyle: CSSProperties = {
  display: "grid",
  gap: "0.3rem",
  padding: spacing.md,
  borderRadius: "10px",
  border: `1px solid ${colors.border}`,
  background: "#f8fafc",
};

const summaryEyebrowStyle: CSSProperties = {
  color: colors.accent,
  fontSize: "0.8rem",
  fontWeight: 800,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
};

const summaryValueStyle: CSSProperties = {
  color: colors.textPrimary,
  lineHeight: 1.5,
};

const detailsGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 12rem), 1fr))",
  gap: spacing.sm,
};

const detailPanelStyle: CSSProperties = {
  display: "grid",
  gap: "0.3rem",
  padding: spacing.md,
  borderRadius: "10px",
  border: `1px solid ${colors.border}`,
  background: "#f8fafc",
};

const detailLabelStyle: CSSProperties = {
  color: colors.textMuted,
  fontSize: "0.82rem",
  fontWeight: 700,
};

const detailValueStyle: CSSProperties = {
  color: colors.textPrimary,
  lineHeight: 1.45,
};

const cardFooterStyle: CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
};

const cardSecondaryButtonStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "0.4rem",
  padding: "0.75rem 1rem",
  borderRadius: "8px",
  border: `1px solid ${colors.borderStrong}`,
  background: "#ffffff",
  color: colors.textPrimary,
  cursor: "pointer",
  fontWeight: 600,
};

const salesTrialHomeStyles = `
  .sales-trial-offering-card {
    transition: border-color 160ms ease, box-shadow 160ms ease, transform 160ms ease;
  }

  .sales-trial-offering-card:hover {
    border-color: ${colors.info};
    box-shadow: 0 18px 36px rgba(29, 78, 216, 0.14);
    transform: translateY(-2px);
  }

  .sales-trial-offering-card__inner {
    transform-style: preserve-3d;
  }

  .sales-trial-offering-card__face {
    backface-visibility: hidden;
    -webkit-backface-visibility: hidden;
    transition: opacity 220ms ease, transform 260ms ease, visibility 0ms linear 260ms;
  }

  .sales-trial-offering-card__inner[data-show-details="false"] .sales-trial-offering-card__face--front {
    opacity: 1;
    transform: rotateY(0deg);
    visibility: visible;
    pointer-events: auto;
    transition-delay: 0ms, 0ms, 0ms;
  }

  .sales-trial-offering-card__inner[data-show-details="false"] .sales-trial-offering-card__face--back {
    opacity: 0;
    transform: rotateY(180deg);
    visibility: hidden;
    pointer-events: none;
    transition-delay: 0ms, 0ms, 260ms;
  }

  .sales-trial-offering-card__inner[data-show-details="true"] .sales-trial-offering-card__face--front {
    opacity: 0;
    transform: rotateY(-180deg);
    visibility: hidden;
    pointer-events: none;
    transition-delay: 0ms, 0ms, 260ms;
  }

  .sales-trial-offering-card__inner[data-show-details="true"] .sales-trial-offering-card__face--back {
    opacity: 1;
    transform: rotateY(0deg);
    visibility: visible;
    pointer-events: auto;
    transition-delay: 0ms, 0ms, 0ms;
  }

  @media (prefers-reduced-motion: reduce) {
    .sales-trial-offering-card,
    .sales-trial-offering-card__face {
      transition: none !important;
    }

    .sales-trial-offering-card:hover {
      transform: none;
    }

    .sales-trial-offering-card__face,
    .sales-trial-offering-card__inner[data-show-details="false"] .sales-trial-offering-card__face--front,
    .sales-trial-offering-card__inner[data-show-details="false"] .sales-trial-offering-card__face--back,
    .sales-trial-offering-card__inner[data-show-details="true"] .sales-trial-offering-card__face--front,
    .sales-trial-offering-card__inner[data-show-details="true"] .sales-trial-offering-card__face--back {
      transform: none !important;
    }
  }
`;

