/** @vitest-environment jsdom */
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LoginForm } from "../../app/login/login-form";

afterEach(cleanup);

describe("portal login registration paths", () => {
  it("offers separate Certification and Sales Trial account paths", () => {
    render(<LoginForm initialError={null} initialEmail="" />);

    expect(screen.getByRole("link", { name: "Certification demo" }).getAttribute("href")).toBe(
      "/register",
    );
    expect(screen.getByRole("link", { name: "Sales Trial demo" }).getAttribute("href")).toBe(
      "/sales-trial/register",
    );
  });
});
