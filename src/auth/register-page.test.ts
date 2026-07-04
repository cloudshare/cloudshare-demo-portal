import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RegisterForm } from "../../app/register/register-form";

describe("register page", () => {
  it("posts native form submissions to the candidate registration API", () => {
    const html = renderToStaticMarkup(createElement(RegisterForm));

    expect(html).toContain('action="/api/candidate/register"');
    expect(html).toContain('method="post"');
    expect(html).toContain('name="password"');
  });
});
