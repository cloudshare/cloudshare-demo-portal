import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PublishedExamCardHeader } from "./candidate-home";
import {
  candidateHomeAccountActionsStyle,
  candidateHomeAccountPanelStyle,
  candidateHomeHeaderIntroStyle,
  candidateHomeHeaderStyle,
  publishedExamDescriptionStyle,
  publishedExamDurationPillsStyle,
  publishedExamHeaderStyle,
  publishedExamTitleRowStyle,
} from "./candidate-home-layout";

describe("candidate home layout", () => {
  it("lets the signed-in panel stack instead of overlapping the Candidate Home heading", () => {
    expect(candidateHomeHeaderStyle.flexWrap).toBe("wrap");
    expect(candidateHomeHeaderIntroStyle).toMatchObject({
      flex: "1 1 28rem",
      minWidth: 0,
    });
    expect(candidateHomeAccountActionsStyle).toMatchObject({
      flex: "0 1 18rem",
      minWidth: 0,
      maxWidth: "100%",
    });
  });

  it("keeps the signed-in panel within its responsive header column", () => {
    expect(candidateHomeAccountActionsStyle.justifyItems).toBe("stretch");
    expect(candidateHomeAccountPanelStyle).toMatchObject({
      width: "100%",
      minWidth: 0,
      boxSizing: "border-box",
    });
  });

  it("keeps published Exam duration pills aligned with the title when descriptions are long", () => {
    expect(publishedExamHeaderStyle).toMatchObject({
      display: "grid",
      gap: "0.5rem",
    });
    expect(publishedExamTitleRowStyle).toMatchObject({
      display: "flex",
      justifyContent: "space-between",
      flexWrap: "wrap",
    });
    expect(publishedExamDescriptionStyle).toMatchObject({
      maxWidth: "68rem",
    });
    expect(publishedExamDurationPillsStyle).toMatchObject({
      justifyContent: "flex-end",
      flex: "1 1 auto",
      minWidth: 0,
      maxWidth: "100%",
    });

    const html = renderToStaticMarkup(
      createElement(PublishedExamCardHeader, {
        title: "Linux Environment with xRDP v2",
        description:
          "This deliberately long description mirrors a real Exam description and must sit below the title row instead of pushing duration pills beneath itself.",
        runtimeLimit: "20160 minute runtime limit",
        openWindow: "20160 minute open window",
      }),
    );
    expect(html.indexOf("Linux Environment with xRDP v2")).toBeLessThan(
      html.indexOf("20160 minute runtime limit"),
    );
    expect(html.indexOf("20160 minute open window")).toBeLessThan(
      html.indexOf("This deliberately long description"),
    );
  });
});
