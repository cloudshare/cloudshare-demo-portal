import React from "react";
import type { CSSProperties, ReactNode } from "react";
import { pageHeadingStyle } from "./design-tokens";

export function PortalPageHeader({
  eyebrow,
  title,
  description,
  email,
  actions,
}: {
  readonly eyebrow: string;
  readonly title: string;
  readonly description: ReactNode;
  readonly email?: string;
  readonly actions?: ReactNode;
}) {
  return (
    <section style={portalHeaderPanelStyle}>
      <div style={portalHeaderLayoutStyle}>
        <div style={portalHeaderIntroStyle}>
          <p style={portalHeaderEyebrowStyle}>{eyebrow}</p>
          <h1 style={{ ...pageHeadingStyle, margin: "0.35rem 0 0.5rem", fontSize: "2rem", lineHeight: 1.15 }}>
            {title}
          </h1>
          <p style={portalHeaderDescriptionStyle}>{description}</p>
        </div>
        {email || actions ? (
          <div style={portalHeaderAccountActionsStyle}>
            {email ? (
              <div style={portalHeaderAccountPanelStyle}>
                <p style={portalHeaderAccountLabelStyle}>Signed in as</p>
                <p style={portalHeaderAccountEmailStyle}>{email}</p>
              </div>
            ) : null}
            {actions}
          </div>
        ) : null}
      </div>
    </section>
  );
}

export const portalHeaderPanelStyle: CSSProperties = {
  border: "1px solid #d9e1e8",
  borderRadius: "8px",
  padding: "1.5rem",
  background: "#f7fafc",
  marginBottom: "1.25rem",
};

export const portalHeaderLayoutStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: "1rem",
  flexWrap: "wrap",
};

export const portalHeaderIntroStyle: CSSProperties = {
  flex: "1 1 28rem",
  minWidth: 0,
  maxWidth: "48rem",
};

export const portalHeaderEyebrowStyle: CSSProperties = {
  margin: 0,
  color: "#5f6b76",
  fontSize: "0.9rem",
  fontWeight: 600,
};

export const portalHeaderDescriptionStyle: CSSProperties = {
  margin: 0,
  color: "#334155",
  lineHeight: 1.5,
};

export const portalHeaderAccountActionsStyle: CSSProperties = {
  display: "grid",
  gap: "0.75rem",
  justifyItems: "stretch",
  flex: "0 1 18rem",
  minWidth: 0,
  maxWidth: "100%",
};

export const portalHeaderAccountPanelStyle: CSSProperties = {
  border: "1px solid #d9e1e8",
  borderRadius: "8px",
  background: "#ffffff",
  padding: "0.9rem 1rem",
  width: "100%",
  minWidth: 0,
  boxSizing: "border-box",
};

export const portalHeaderAccountLabelStyle: CSSProperties = {
  margin: 0,
  color: "#5f6b76",
  fontSize: "0.85rem",
};

export const portalHeaderAccountEmailStyle: CSSProperties = {
  margin: "0.3rem 0 0",
  color: "#0f172a",
  fontWeight: 600,
  overflowWrap: "anywhere",
};
