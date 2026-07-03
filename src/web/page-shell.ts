import type { CSSProperties } from "react";
import { fontFamily } from "./design-tokens";

/**
 * Shared page-container width for authenticated app pages (Admin Console,
 * Candidate Home/Lab/Score). Matches the widest existing page so dense
 * admin views such as Session Monitoring stop feeling narrower than
 * Candidate Home. Auth entry forms (login/register) intentionally keep
 * their own narrower, centered width and do not use this shell.
 */
export const PAGE_SHELL_MAX_WIDTH = "1120px";

export const pageShellStyle: CSSProperties = {
  fontFamily: fontFamily.body,
  padding: "2rem 1.25rem 3rem",
  maxWidth: PAGE_SHELL_MAX_WIDTH,
  margin: "0 auto",
  width: "100%",
  boxSizing: "border-box",
};
