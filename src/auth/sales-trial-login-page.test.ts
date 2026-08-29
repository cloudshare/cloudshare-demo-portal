import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SalesTrialLoginForm } from "../../app/sales-trial/login/login-form";

describe("sales trial login page", () => {
  it("posts native form submissions to the Sales Trial login API", () => {
    const html = renderToStaticMarkup(
      createElement(SalesTrialLoginForm, {
        initialEmail: "",
        initialError: null,
      }),
    );

    expect(html).toContain('action="/api/sales-trial/login"');
    expect(html).toContain('method="post"');
    expect(html).toContain('name="password"');
  });
});
