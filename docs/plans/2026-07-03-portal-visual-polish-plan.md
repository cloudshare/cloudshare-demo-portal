# Portal Visual Polish Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use anthropic-skills:subagent-driven-development to implement this plan task-by-task (one implementation sub-agent per task, orchestrator reviews between tasks, per AGENTS.md's implementation/review split).

**Goal:** Beautify the Certalis portal (currently plain inline `system-ui` styles with no shared design language) into a clean, minimal-enterprise-SaaS look, while keeping every page's container width already unified by `page-shell.ts` (issue #257, first commit).

**Architecture:** Five small, typed, testable style-constant modules under `src/web/` (`design-tokens.ts`, `button-styles.ts`, `card-styles.ts`, `status-badge.ts`) plus one hand-written `app/globals.css` and a `next/font/google` setup in `app/layout.tsx`. No component library, no Tailwind, no theme provider — this mirrors the existing `page-shell.ts` / `candidate-home-layout.ts` pattern already in the codebase. Application of these modules is split into two tiers (see "Scope tiers" below) to keep the change reviewable.

**Tech Stack:** Next.js (App Router), React, TypeScript, Vitest, plain inline `style={{}}` objects + one CSS file.

---

## Scope tiers

**Tier A — full visual treatment** (cards, primary/secondary buttons, status badges, refined headings, eyebrow labels): Login, Register, Candidate Home, Candidate Lab, Candidate Score/ScoreDisplay, Admin Console's chrome (header/nav/tabs) + Connection tab + Candidate-provisioning panel, Session Monitoring Panel (explicitly named in issue #257 as the page that "feels noticeably narrower... leaves usable horizontal space unused").

**Tier B — token normalization only** (swap hardcoded hex for the same shared tokens/status-badge helper; keep existing table/panel structure as-is): Admin Console's Exam Catalog table, Audit Trail tab, Event Log tab, Support Diagnostics tab (`diagnostic-log-table.tsx`, `event-log-table.tsx`), Resources tab, `monitoring-attempt-details.tsx`. These are dense, low-traffic-during-a-demo operational tables; the global `app/globals.css` button/focus polish and font change apply to them automatically. Restyling every table cell would be disproportionate scope for what these screens are for.

Both tiers get the same global font change and the same global button hover/focus polish for free, since those are applied once in `app/layout.tsx` / `app/globals.css`.

---

### Task 1: Global typography — `next/font` + `app/globals.css`

**Files:**
- Modify: `app/layout.tsx`
- Create: `app/globals.css`

**Step 1: Add font loading to the root layout**

Replace the full contents of `app/layout.tsx`:

```tsx
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Fraunces, Manrope } from "next/font/google";
import "./globals.css";

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Certalis CloudShare Demo Portal",
  description: "Certalis admin and candidate portal for Helios CX CloudShare demos",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${fraunces.variable} ${manrope.variable}`}>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
```

**Step 2: Create `app/globals.css`**

```css
:root {
  --font-body: "Manrope", system-ui, sans-serif;
  --font-display: "Fraunces", Georgia, serif;
  --color-focus-ring: #0f6d66;
}

*, *::before, *::after {
  box-sizing: border-box;
}

html, body {
  margin: 0;
  padding: 0;
}

body {
  font-family: var(--font-body);
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
  background: #f8fafc;
  color: #0f172a;
}

h1, h2, h3 {
  font-family: var(--font-display);
  font-weight: 600;
  letter-spacing: -0.01em;
}

button {
  font-family: var(--font-body);
  transition: transform 120ms ease, box-shadow 120ms ease, filter 120ms ease,
    background-color 120ms ease, border-color 120ms ease;
}

button:not(:disabled) {
  cursor: pointer;
}

button:hover:not(:disabled) {
  filter: brightness(0.96);
  transform: translateY(-1px);
  box-shadow: 0 4px 10px rgba(15, 23, 42, 0.08);
}

button:active:not(:disabled) {
  transform: translateY(0);
  box-shadow: none;
}

button:focus-visible,
a:focus-visible,
input:focus-visible,
select:focus-visible,
textarea:focus-visible {
  outline: 2px solid var(--color-focus-ring);
  outline-offset: 2px;
}

button:disabled {
  cursor: not-allowed;
  filter: none;
  transform: none;
}
```

**Step 3: Verify (no automated test — see note)**

CSS pseudo-classes (`:hover`, `:focus-visible`) aren't meaningfully unit-testable in this stack (jsdom doesn't run real hover/focus interaction + paint). Verification for this task is the browser-smoke pass in Task 12: confirm via `preview_inspect` that a heading's computed `font-family` includes "Fraunces" and a button's computed `font-family` includes "Manrope", and via `preview_eval`/manual hover that the button lift/shadow applies.

Run `npm run dev` (or the agent-owned preview) and load `/login` to confirm the page still renders (no font-loading crash) before moving on.

**Step 4: Commit**

```bash
git add app/layout.tsx app/globals.css
git commit -m "Add Fraunces/Manrope typography and global button interaction states"
```

---

### Task 2: `design-tokens.ts`

**Files:**
- Create: `src/web/design-tokens.ts`
- Test: `src/web/design-tokens.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { colors, radius, spacing } from "./design-tokens";

function remToNumber(value: string): number {
  return Number(value.replace("rem", ""));
}

describe("design tokens", () => {
  it("gives every semantic color role a distinct value", () => {
    const roles = [colors.accent, colors.danger, colors.warning, colors.success, colors.info, colors.neutral];
    expect(new Set(roles).size).toBe(roles.length);
  });

  it("keeps the spacing scale strictly increasing", () => {
    const scale = [spacing.xs, spacing.sm, spacing.md, spacing.lg, spacing.xl, spacing.xxl].map(remToNumber);
    for (let i = 1; i < scale.length; i += 1) {
      expect(scale[i]).toBeGreaterThan(scale[i - 1]);
    }
  });

  it("uses a fully-rounded pill radius for badges", () => {
    expect(radius.pill).toBe("999px");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/web/design-tokens.test.ts`
Expected: FAIL — cannot find module `./design-tokens`.

**Step 3: Write the implementation**

```ts
import type { CSSProperties } from "react";

export const colors = {
  surface: "#ffffff",
  surfaceMuted: "#f8fafc",
  surfaceSubtle: "#f1f5f9",
  border: "#e2e8f0",
  borderStrong: "#cbd5e1",
  textPrimary: "#0f172a",
  textSecondary: "#475569",
  textMuted: "#64748b",
  accent: "#0f6d66",
  accentStrong: "#0b544f",
  accentSoft: "#effaf7",
  danger: "#b91c1c",
  dangerSoft: "#fef2f2",
  warning: "#b45309",
  warningSoft: "#fffbeb",
  success: "#047857",
  successSoft: "#ecfdf5",
  info: "#1d4ed8",
  infoSoft: "#eff6ff",
  neutral: "#475569",
  neutralSoft: "#f1f5f9",
} as const;

export const spacing = {
  xs: "0.35rem",
  sm: "0.6rem",
  md: "1rem",
  lg: "1.5rem",
  xl: "2rem",
  xxl: "3rem",
} as const;

export const radius = {
  sm: "6px",
  md: "10px",
  lg: "14px",
  pill: "999px",
} as const;

export const shadow = {
  sm: "0 1px 2px rgba(15, 23, 42, 0.06)",
  md: "0 4px 16px rgba(15, 23, 42, 0.08)",
} as const;

export const fontFamily = {
  display: "var(--font-display, Georgia, serif)",
  body: "var(--font-body, system-ui, sans-serif)",
} as const;

export const pageHeadingStyle: CSSProperties = {
  fontFamily: fontFamily.display,
  fontWeight: 600,
  letterSpacing: "-0.01em",
  color: colors.textPrimary,
};

export const eyebrowLabelStyle: CSSProperties = {
  margin: 0,
  color: colors.accent,
  fontSize: "0.78rem",
  fontWeight: 700,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
};
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/web/design-tokens.test.ts`
Expected: PASS (3 tests)

**Step 5: Commit**

```bash
git add src/web/design-tokens.ts src/web/design-tokens.test.ts
git commit -m "Add shared design tokens (colors, spacing, radius, shadow, typography)"
```

---

### Task 3: `button-styles.ts`

**Files:**
- Create: `src/web/button-styles.ts`
- Test: `src/web/button-styles.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import {
  compactButtonStyle,
  dangerButtonStyle,
  disabledButtonStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
} from "./button-styles";

describe("button styles", () => {
  it("gives primary and secondary buttons the same shape but different fills", () => {
    expect(primaryButtonStyle.borderRadius).toBe(secondaryButtonStyle.borderRadius);
    expect(primaryButtonStyle.padding).toBe(secondaryButtonStyle.padding);
    expect(primaryButtonStyle.background).not.toBe(secondaryButtonStyle.background);
    expect(primaryButtonStyle.color).toBe("#ffffff");
    expect(secondaryButtonStyle.color).not.toBe("#ffffff");
  });

  it("marks danger actions distinctly from primary", () => {
    expect(dangerButtonStyle.background).not.toBe(primaryButtonStyle.background);
  });

  it("keeps the compact button visibly smaller than the standard secondary button", () => {
    expect(String(compactButtonStyle.padding)).not.toBe(String(secondaryButtonStyle.padding));
  });

  it("visually communicates disabled state via color, not just the disabled attribute", () => {
    expect(disabledButtonStyle.cursor).toBe("not-allowed");
    expect(disabledButtonStyle.background).not.toBe(primaryButtonStyle.background);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/web/button-styles.test.ts`
Expected: FAIL — cannot find module `./button-styles`.

**Step 3: Write the implementation**

```ts
import type { CSSProperties } from "react";
import { colors, radius } from "./design-tokens";

const baseButtonStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "0.4rem",
  padding: "0.65rem 1.1rem",
  borderRadius: radius.sm,
  fontWeight: 600,
  fontSize: "0.95rem",
  lineHeight: 1.2,
};

export const primaryButtonStyle: CSSProperties = {
  ...baseButtonStyle,
  border: `1px solid ${colors.accent}`,
  background: colors.accent,
  color: "#ffffff",
};

export const secondaryButtonStyle: CSSProperties = {
  ...baseButtonStyle,
  border: `1px solid ${colors.borderStrong}`,
  background: colors.surface,
  color: colors.textPrimary,
};

export const dangerButtonStyle: CSSProperties = {
  ...baseButtonStyle,
  border: `1px solid ${colors.danger}`,
  background: colors.danger,
  color: "#ffffff",
};

export const compactButtonStyle: CSSProperties = {
  ...secondaryButtonStyle,
  padding: "0.4rem 0.75rem",
  fontSize: "0.85rem",
};

export const disabledButtonStyle: CSSProperties = {
  background: colors.surfaceSubtle,
  border: `1px solid ${colors.border}`,
  color: colors.textMuted,
  cursor: "not-allowed",
};
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/web/button-styles.test.ts`
Expected: PASS (4 tests)

**Step 5: Commit**

```bash
git add src/web/button-styles.ts src/web/button-styles.test.ts
git commit -m "Add shared button style constants (primary/secondary/danger/compact/disabled)"
```

---

### Task 4: `card-styles.ts`

**Files:**
- Create: `src/web/card-styles.ts`
- Test: `src/web/card-styles.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { alertPanelStyle, cardStyle, mutedPanelStyle } from "./card-styles";

describe("card styles", () => {
  it("gives the standard card a soft shadow, unlike the flat muted panel", () => {
    expect(cardStyle.boxShadow).toBeTruthy();
    expect(mutedPanelStyle.boxShadow).toBeUndefined();
    expect(cardStyle.borderRadius).toBe(mutedPanelStyle.borderRadius);
  });

  it("gives every alert tone a distinct background with a matching text color", () => {
    const tones = Object.values(alertPanelStyle);
    const backgrounds = tones.map((tone) => tone.background);
    expect(new Set(backgrounds).size).toBe(tones.length);
    tones.forEach((tone) => expect(tone.color).toBeTruthy());
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/web/card-styles.test.ts`
Expected: FAIL — cannot find module `./card-styles`.

**Step 3: Write the implementation**

```ts
import type { CSSProperties } from "react";
import { colors, radius, shadow, spacing } from "./design-tokens";

export const cardStyle: CSSProperties = {
  border: `1px solid ${colors.border}`,
  borderRadius: radius.md,
  background: colors.surface,
  padding: spacing.lg,
  boxShadow: shadow.sm,
};

export const mutedPanelStyle: CSSProperties = {
  border: `1px solid ${colors.border}`,
  borderRadius: radius.md,
  background: colors.surfaceMuted,
  padding: spacing.lg,
};

export const alertPanelStyle: Record<"danger" | "warning" | "info" | "success", CSSProperties> = {
  danger: {
    border: `1px solid ${colors.danger}`,
    borderRadius: radius.md,
    background: colors.dangerSoft,
    color: colors.danger,
    padding: spacing.md,
  },
  warning: {
    border: `1px solid ${colors.warning}`,
    borderRadius: radius.md,
    background: colors.warningSoft,
    color: colors.warning,
    padding: spacing.md,
  },
  info: {
    border: `1px solid ${colors.info}`,
    borderRadius: radius.md,
    background: colors.infoSoft,
    color: colors.info,
    padding: spacing.md,
  },
  success: {
    border: `1px solid ${colors.success}`,
    borderRadius: radius.md,
    background: colors.successSoft,
    color: colors.success,
    padding: spacing.md,
  },
};
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/web/card-styles.test.ts`
Expected: PASS (2 tests)

**Step 5: Commit**

```bash
git add src/web/card-styles.ts src/web/card-styles.test.ts
git commit -m "Add shared card/panel style constants"
```

---

### Task 5: `status-badge.ts`

**Files:**
- Create: `src/web/status-badge.ts`
- Test: `src/web/status-badge.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import {
  getDiagnosticLevelTone,
  getExamAttemptStatusTone,
  getExamStatusTone,
  getOutcomeTone,
  statusBadgeStyle,
} from "./status-badge";

describe("status badge", () => {
  it("gives every tone a fully rounded pill shape", () => {
    (["neutral", "info", "positive", "warning", "negative"] as const).forEach((tone) => {
      expect(statusBadgeStyle(tone).borderRadius).toBe("999px");
    });
  });

  it("maps ExamAttempt statuses to distinguishable tones", () => {
    expect(getExamAttemptStatusTone("completed")).toBe("positive");
    expect(getExamAttemptStatusTone("expired")).toBe("neutral");
    expect(getExamAttemptStatusTone("suspended")).toBe("warning");
    expect(getExamAttemptStatusTone("in_progress")).toBe("warning");
    expect(getExamAttemptStatusTone("ready")).toBe("info");
    expect(getExamAttemptStatusTone("scheduled")).toBe("neutral");
  });

  it("maps Exam catalog status, audit/diagnostic outcome, and diagnostic level correctly", () => {
    expect(getExamStatusTone("published")).toBe("positive");
    expect(getExamStatusTone("draft")).toBe("neutral");
    expect(getOutcomeTone("failure")).toBe("negative");
    expect(getOutcomeTone("success")).toBe("positive");
    expect(getDiagnosticLevelTone("error")).toBe("negative");
    expect(getDiagnosticLevelTone("warn")).toBe("warning");
    expect(getDiagnosticLevelTone("info")).toBe("info");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/web/status-badge.test.ts`
Expected: FAIL — cannot find module `./status-badge`.

**Step 3: Write the implementation**

```ts
import type { CSSProperties } from "react";
import { colors, radius } from "./design-tokens";

export type StatusTone = "neutral" | "info" | "positive" | "warning" | "negative";

const toneColors: Record<StatusTone, { background: string; color: string }> = {
  neutral: { background: colors.neutralSoft, color: colors.neutral },
  info: { background: colors.infoSoft, color: colors.info },
  positive: { background: colors.successSoft, color: colors.success },
  warning: { background: colors.warningSoft, color: colors.warning },
  negative: { background: colors.dangerSoft, color: colors.danger },
};

export function statusBadgeStyle(tone: StatusTone): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    padding: "0.25rem 0.65rem",
    borderRadius: radius.pill,
    fontWeight: 600,
    fontSize: "0.78rem",
    whiteSpace: "nowrap",
    ...toneColors[tone],
  };
}

export function getExamAttemptStatusTone(status: string): StatusTone {
  switch (status) {
    case "ready":
      return "info";
    case "in_progress":
    case "suspended":
      return "warning";
    case "completed":
      return "positive";
    case "expired":
    case "scheduled":
    default:
      return "neutral";
  }
}

export function getExamStatusTone(status: string): StatusTone {
  return status === "published" ? "positive" : "neutral";
}

export function getDiagnosticLevelTone(level: string): StatusTone {
  switch (level) {
    case "error":
      return "negative";
    case "warn":
      return "warning";
    default:
      return "info";
  }
}

export function getOutcomeTone(outcome: string): StatusTone {
  return outcome === "failure" ? "negative" : "positive";
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/web/status-badge.test.ts`
Expected: PASS (3 tests)

**Step 5: Commit**

```bash
git add src/web/status-badge.ts src/web/status-badge.test.ts
git commit -m "Add shared status-badge tones and per-domain status mapping helpers"
```

---

### Task 6: Update `page-shell.ts` to use the shared body font token

**Files:**
- Modify: `src/web/page-shell.ts`

**Step 1: Replace the hardcoded font family**

In `src/web/page-shell.ts`, change:

```ts
export const pageShellStyle: CSSProperties = {
  fontFamily: "system-ui, sans-serif",
```

to:

```ts
import { fontFamily } from "./design-tokens";
// ...
export const pageShellStyle: CSSProperties = {
  fontFamily: fontFamily.body,
```

**Step 2: Run existing test to confirm no regression**

Run: `npx vitest run src/web/page-shell.test.ts`
Expected: PASS (2 tests — neither asserts on `fontFamily`, so this is safe)

**Step 3: Commit**

```bash
git add src/web/page-shell.ts
git commit -m "Point page-shell font family at the shared design token"
```

---

### Task 7 (Tier A): Login and Register forms

**Files:**
- Modify: `app/login/login-form.tsx`
- Modify: `app/register/register-form.tsx`

**Step 1: Apply card + token styling to the login form**

In `app/login/login-form.tsx`, add imports:

```tsx
import { cardStyle } from "@/web/card-styles";
import { primaryButtonStyle } from "@/web/button-styles";
import { colors, pageHeadingStyle, spacing } from "@/web/design-tokens";
```

Replace the outer `<main>` wrapper (currently `style={{ fontFamily: "system-ui, sans-serif", padding: "2rem", maxWidth: "420px", margin: "0 auto" }}`) with a centered flex container plus a card:

```tsx
<main
  style={{
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
    background: colors.surfaceMuted,
  }}
>
  <div style={{ ...cardStyle, width: "100%", maxWidth: "420px" }}>
    <h1 style={{ ...pageHeadingStyle, fontSize: "1.6rem", marginTop: 0 }}>Certalis Portal Login</h1>
    <p style={{ color: colors.textSecondary, marginBottom: spacing.lg }}>
      Sign in as a Helios admin or Candidate.
    </p>
    {/* existing <form> unchanged, except the submit button */}
```

Replace the submit button's style (currently `style={{ padding: "0.8rem 1rem" }}`) with `style={primaryButtonStyle}`.

Close the new wrapping `</div>` before the final `</main>`.

**Step 2: Apply the same treatment to Register**

Repeat the identical transformation in `app/register/register-form.tsx` (same imports, same wrapper swap, same `primaryButtonStyle` on the "Create account" submit button). Keep its existing field validation/error logic untouched — this is a pure style-prop change.

**Step 3: Run existing tests**

Run: `npx vitest run src/auth/login-page.test.ts src/auth/home-page.test.ts`
Expected: PASS — these test routing/redirect behavior, not styling, and must be unaffected.

**Step 4: Commit**

```bash
git add app/login/login-form.tsx app/register/register-form.tsx
git commit -m "Apply card + token styling to Login and Register forms"
```

---

### Task 8 (Tier A): Candidate Home + `candidate-home-layout.ts`

**Files:**
- Modify: `src/web/candidate-home-layout.ts`
- Modify: `src/web/candidate-home.tsx`

**Step 1: Point the existing layout constants at shared tokens**

In `candidate-home-layout.ts`, replace the hardcoded `publishedExamDescriptionStyle` color (`#444`) with `colors.textSecondary` from `design-tokens.ts` (import it). Leave the structural (flex/grid) properties untouched — only swap color/border/radius/shadow literals for the equivalent token.

**Step 2: Run the existing layout test**

Run: `npx vitest run src/web/candidate-home-layout.test.ts`
Expected: PASS (3 tests) — it asserts on flex/grid shape, not on the exact color literal, so this is safe.

**Step 3: Replace local style constants in `candidate-home.tsx` with shared modules**

`candidate-home.tsx` already defines its own local `sectionPanelStyle`, `cardStyle`, `metaItemStyle`, `primaryButtonStyle`, `secondaryButtonStyle`, `disabledButtonStyle`, `statusBadgeStyle`, `pillStyle`, `eyebrowStyle`, `messagePanelStyle`, `warningPanelStyle` (see the catalogue for exact current values). Replace each with the shared equivalent:

| Local constant (current) | Replace with |
|---|---|
| `sectionPanelStyle`, `cardStyle`, `metaItemStyle` | `cardStyle` from `@/web/card-styles` (use `mutedPanelStyle` for the ones with a muted/off-white background) |
| `primaryButtonStyle` | `primaryButtonStyle` from `@/web/button-styles` |
| `secondaryButtonStyle` | `secondaryButtonStyle` from `@/web/button-styles` |
| `disabledButtonStyle` | `disabledButtonStyle` from `@/web/button-styles` |
| `statusBadgeStyle`, `pillStyle` | `statusBadgeStyle(getExamAttemptStatusTone(attempt.displayStatus))` from `@/web/status-badge` at each call site that renders an ExamAttempt status |
| `eyebrowStyle` | `eyebrowLabelStyle` from `@/web/design-tokens` |
| `messagePanelStyle` | `mutedPanelStyle` from `@/web/card-styles` |
| `warningPanelStyle` | `alertPanelStyle.warning` from `@/web/card-styles` |
| Main `<h1>` (`{ margin: "0.35rem 0 0.5rem", fontSize: "2rem" }`) | merge with `pageHeadingStyle` from `@/web/design-tokens`: `{ ...pageHeadingStyle, margin: "0.35rem 0 0.5rem", fontSize: "2rem" }` |

Delete the now-unused local constant declarations once every call site is migrated (grep for the old names to confirm zero remaining references before deleting).

**Step 4: Run existing tests**

Run: `npx vitest run src/web/candidate-home.test.ts src/web/candidate-scheduling.test.ts src/web/candidate-home-layout.test.ts` (adjust to the actual candidate-home test filename found via `Glob src/web/candidate-home*.test.ts` if it differs)
Expected: PASS — these test scheduling/rendering logic, not exact style values.

**Step 5: Browser-verify no visual regression**

This file renders the busiest page in the app (scheduled attempts + published exam catalog). After the edit, load `/candidate` in the browser preview and confirm: no overlapping text, status text now renders as a colored pill, buttons show the new primary/secondary look.

**Step 6: Commit**

```bash
git add src/web/candidate-home-layout.ts src/web/candidate-home.tsx
git commit -m "Apply shared design tokens, cards, buttons, and status badges to Candidate Home"
```

---

### Task 9 (Tier A): Candidate Lab Shell

**Files:**
- Modify: `src/web/candidate-lab-shell.tsx`

**Step 1: Replace local styles with shared modules**

- Replace the local `secondaryButtonStyle` constant (lines ~229-236) with the import from `@/web/button-styles`.
- Replace the three ad hoc card-shaped blocks (summary item card ~159-164, current-action panel ~178-184) with `cardStyle` / `mutedPanelStyle` from `@/web/card-styles` (the summary item that highlights `"Status"` with `#f0fdf4` background becomes `statusBadgeStyle(getExamAttemptStatusTone(...))` applied to the value text instead of tinting the whole card).
- Replace the eyebrow label (~106) with `eyebrowLabelStyle` from `@/web/design-tokens`.
- Replace the `<h1>` heading style with `{ ...pageHeadingStyle, ...existingOverrides }`.

**Step 2: Run existing tests**

Run: `npx vitest run src/web/candidate-lab-state.test.ts src/web/lab-launcher.test.ts src/web/lab-launcher-state.test.ts`
Expected: PASS — these test launcher state machine logic, not styling.

**Step 3: Commit**

```bash
git add src/web/candidate-lab-shell.tsx
git commit -m "Apply shared design tokens, cards, and buttons to Candidate Lab"
```

---

### Task 10 (Tier A): Candidate Score page + `score-display.tsx`

**Files:**
- Modify: `app/candidate/score/page.tsx`
- Modify: `src/web/score-display.tsx`

**Step 1: `score-display.tsx` already has local style constants that closely match the new shared shape** (`panelStyle`, `primaryButtonStyle`, `secondaryButtonStyle`, `eyebrowStyle` — see catalogue lines ~363-462). Replace each with the shared import exactly as in Task 8's table (`panelStyle` → `cardStyle`; `summaryCardStyle`/`limitationsCardStyle`/`statCardStyle`/`stepCardStyle` → `cardStyle` or `mutedPanelStyle` depending on whether they currently have a shadow-like emphasis or a flat muted background; `stepStatusStyle` → `statusBadgeStyle("positive")`/`statusBadgeStyle("neutral")` depending on the `Completed`/`Not completed` boolean already computed in the component).

**Step 2: Update the page wrapper heading**

In `app/candidate/score/page.tsx`, merge the `<h1>Session complete</h1>` style with `pageHeadingStyle` from `@/web/design-tokens` in both branches (missing-`examAttemptId` and normal).

**Step 3: Run existing tests**

Run: `npx vitest run src/web/score-display.test.ts src/domain/score-result.test.ts src/api/score.test.ts`
Expected: PASS — score computation/retrieval logic is untouched.

**Step 4: Commit**

```bash
git add app/candidate/score/page.tsx src/web/score-display.tsx
git commit -m "Apply shared design tokens, cards, buttons, and status badges to Candidate Score"
```

---

### Task 11 (Tier A): Admin Console chrome, Connection tab, Candidate provisioning

**Files:**
- Modify: `src/web/admin-console.tsx`

**Step 1: Header, nav, and tab buttons**

- Merge the `<h1>Certalis Admin Console</h1>` style with `pageHeadingStyle`.
- Replace the "Log out" button style (`{ padding: "0.55rem 0.9rem" }`) with `secondaryButtonStyle`.
- Replace the tab-button style block (~1195-1204) to use `colors.accent` instead of the hardcoded `#2563eb`/`#0f172a` for the active state, keeping the existing active/inactive/support-workflow branching logic — only the literal color values move to tokens (`colors.textPrimary` for the active background, `colors.accentSoft` for the support-workflow inactive background, `colors.accent` for the active ring/border).

**Step 2: Error/warning banners**

Replace the error banner style (~1213-1253, currently `{ color: "#b00020", background: "#fff0f0", ... }`) with `alertPanelStyle.danger` from `@/web/card-styles`, and the connection-warning box (~1336-1352, `#7a4b00`/`#fff7e6`) with `alertPanelStyle.warning`.

**Step 3: Candidate provisioning panel + Connection tab panel**

Replace the provisioning panel background block (~1258-1312, `{ padding: "1rem", background: "#f7f7f8", ... }`) and the connection status box (~1318) with `mutedPanelStyle` from `@/web/card-styles`. Replace the webhook callback panel (~1400-1448, `#eef6ff`/`#c7ddff`) with `alertPanelStyle.info`. Replace the "Save CloudShare Connection" / "Test connection" buttons with `primaryButtonStyle` / `secondaryButtonStyle` respectively. Replace the "Create Candidate" button with `primaryButtonStyle`.

**Step 4: Run existing tests**

Run: `npx vitest run src/web/admin-console.test.ts src/web/admin-console-state.test.ts src/web/admin-console-state-extra.test.ts`
Expected: PASS — these test tab/filter/state logic, not exact colors.

**Step 5: Browser-verify**

Load `/admin`, confirm the Connection tab and Candidates provisioning section render with the new card/button treatment and the tab nav still switches correctly (click each tab, confirm no console errors — same process as the Task 12 full smoke, but do a quick spot-check here since this is the highest-traffic tab).

**Step 6: Commit**

```bash
git add src/web/admin-console.tsx
git commit -m "Apply shared design tokens, cards, and buttons to Admin Console chrome, Connection tab, and Candidate provisioning"
```

---

### Task 12 (Tier A): Session Monitoring Panel

**Files:**
- Modify: `src/web/session-monitoring-panel.tsx`

**Step 1: Replace card/panel constants**

Replace `statusMetricStyle`/`selectedStatusMetricStyle` (~94-111), `filterPanelStyle` (~137-144), `queueCardBaseStyle` + the `liveQueueStyles` tint map (~196-226), and `historyCardStyle` (~228-231) with `cardStyle` / `mutedPanelStyle` as the base, keeping each queue's distinct tint by deriving it from the new `statusBadgeStyle` tone backgrounds (`getExamAttemptStatusTone("scheduled")` → neutral tint, `"ready"` → info tint, `"in_progress"`/`"suspended"` → warning tint) instead of the current bespoke `liveQueueStyles` hex map, so the queue tinting and the attempt-status badges finally use the same color language (this directly addresses the "Session Monitoring feels inconsistent" root complaint from issue #257).

**Step 2: Replace the status badge**

Replace the inline status badge (~345-355, `formatAttemptStatus(attempt.status)`) with `statusBadgeStyle(getExamAttemptStatusTone(attempt.status))` from `@/web/status-badge`, keeping the existing `formatAttemptStatus` text formatting (underscore → space) as the badge's label text.

**Step 3: Replace buttons**

Replace "Refresh Monitoring", "Clear filters", and "Load more history" button styles with `secondaryButtonStyle` (or `compactButtonStyle` for the smaller inline ones).

**Step 4: Run existing tests**

Run: `npx vitest run src/web/session-monitoring-panel.test.ts`
Expected: PASS.

**Step 5: Browser-verify (this is the page named in issue #257)**

Load `/admin`, switch to Session Monitoring, confirm: queue cards render with consistent tinting, status badges are pill-shaped and color-coded, filters/buttons show the new look, no console errors. Resize to mobile and confirm no overlap.

**Step 6: Commit**

```bash
git add src/web/session-monitoring-panel.tsx
git commit -m "Apply shared design tokens, cards, buttons, and status badges to Session Monitoring"
```

---

### Task 13 (Tier B): Token normalization for remaining Admin Console tabs, tables, and Monitoring Attempt Details

**Files:**
- Modify: `src/web/admin-console.tsx` (Exam Catalog table, Audit Trail tab, Event Log tab, Support Diagnostics filter panel, Resources tab — the parts not already covered by Task 11)
- Modify: `src/web/diagnostic-log-table.tsx`
- Modify: `src/web/event-log-table.tsx`
- Modify: `src/web/monitoring-attempt-details.tsx`

**Step 1: Mechanical token swap**

This is Tier B: keep every table's existing structure (columns, row logic, overflow handling) exactly as-is. Only replace hardcoded hex literals with the token equivalent that has the closest existing value, so these screens share the same palette as Tier A without a structural redesign:

| Hardcoded hex found in catalogue | Replace with |
|---|---|
| `#f5f5f5` (table header backgrounds) | `colors.surfaceSubtle` |
| `#ddd`, `#eee` (table borders) | `colors.border` |
| `#666`, `#555` (secondary text) | `colors.textSecondary` |
| `#b00020` (error text/outcome) | `colors.danger` |
| `green/red` string literals (audit outcome color, `admin-console.tsx` ~1903) | `colors.success` / `colors.danger` |
| `#fde8e8`/`#9b1c1c` (diagnostic error level badge) | replace the whole badge with `statusBadgeStyle(getDiagnosticLevelTone(entry.level))` |
| `#fff4db`/`#8a5a00` (diagnostic warn level badge) | same — covered by `getDiagnosticLevelTone` |
| `#edf4ff`/`#1d4ed8` (diagnostic info level badge) | same |
| `#fde8e8`/`#b00020` and `#e7f7ef`/`#0f766e` (diagnostic outcome badge) | `statusBadgeStyle(getOutcomeTone(entry.outcome))` |
| `#f7f9fc` (expanded row detail background) | `colors.surfaceMuted` |
| Exam status cell (`admin-console.tsx` ~1792, plain `{exam.status}` text) | wrap in `statusBadgeStyle(getExamStatusTone(exam.status))` |
| `monitoring-attempt-details.tsx` `detailPairStyle` (~69-76, `#e5e7eb`/`#fafafa`) | `mutedPanelStyle` |

**Step 2: Add a card wrapper to tables that currently have none**

`event-log-table.tsx` and the Exam Catalog / Audit Trail / Resources sync-result tables in `admin-console.tsx` currently render a bare `<table>` with no surrounding border/radius (unlike `diagnostic-log-table.tsx`, which already wraps in a bordered/rounded `overflowX: auto` container). Wrap each of these tables in the same pattern: `<div style={{ ...cardStyle, padding: 0, overflowX: "auto" }}>`.

**Step 3: Run existing tests**

Run: `npx vitest run src/web/diagnostic-log-table.test.ts src/web/event-log-table.test.ts src/web/event-and-support-log-table.test.ts src/web/monitoring-attempt-details.test.ts src/web/admin-console.test.ts`
Expected: PASS — these test data rendering/filtering logic, not exact colors.

**Step 4: Commit**

```bash
git add src/web/admin-console.tsx src/web/diagnostic-log-table.tsx src/web/event-log-table.tsx src/web/monitoring-attempt-details.tsx
git commit -m "Normalize remaining Admin Console tabs and tables onto shared design tokens"
```

---

### Task 14: Full verification pass

**Step 1: Static checks**

```bash
npm run lint
npm run typecheck
npm test
git status
```

Expected: all clean, all tests passing (should be ≥ 879 existing tests + the ~12 new tests from Tasks 2-5).

**Step 2: Grep for leftover unconverted literals (spot-check, not exhaustive)**

```bash
grep -rn "system-ui, sans-serif" src/web app --include=*.tsx
```

Expected: no matches outside of `design-tokens.ts`'s own `fontFamily.body` fallback string (that occurrence is fine — it's the CSS `var()` fallback, not a hardcoded usage).

**Step 3: Full browser smoke (agent-owned port, per AGENTS.md)**

Repeat the same smoke process used for the width-only pass earlier on this PR: log in as admin and as a Candidate, visit Login, Register, every Admin Console tab (esp. Session Monitoring), Candidate Home, Candidate Lab, Candidate Score, at both desktop and mobile widths. Capture console errors/warnings at each step. Confirm: fonts render (Fraunces headings, Manrope body), buttons show hover/focus feedback, status badges are color-coded pills, no visual overlap or regressions from the Tier A restyle.

**Step 4: Update the PR body** with the second round of changes (what/why/tests/smoke/review/risks/human QA status), per AGENTS.md's PR-summary requirement.

---

## Notes for the implementing agent(s)

- Every task above is presentational-only. If any task seems to require touching business logic (scheduling, entitlement, CloudShare calls, data models) to make a style change work, stop and flag it rather than proceeding — that would be scope creep beyond issue #257.
- Preserve `CONTEXT.md` vocabulary exactly (Certalis, Candidate, Exam, ExamAttempt, etc.) in any new copy/labels introduced.
- Do not introduce new npm dependencies. `next/font/google` is already part of the installed `next` package.
- Line numbers cited above are from the pre-Task-1 state of each file (post the width-only PR commits already on this branch) and will drift as earlier tasks in this same file are applied — treat them as orientation, not ground truth; match by the quoted code snippet instead.
