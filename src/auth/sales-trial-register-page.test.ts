import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SalesTrialRegisterForm } from "../../app/sales-trial/register/register-form";

describe("sales trial register page", () => {
  it("posts native form submissions to the Sales Trial registration API", () => {
    const html = renderToStaticMarkup(createElement(SalesTrialRegisterForm));

    expect(html).toContain('action="/api/sales-trial/register"');
    expect(html).toContain('method="post"');
    expect(html).toContain('name="password"');
  });
});
