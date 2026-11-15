// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LoginForm } from "@/features/auth/components/login-form";

describe("LoginForm", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("validates locally without calling the server", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    render(<LoginForm redirectPath="/dashboard" />);

    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Enter a valid e-mail address.")).toBeInTheDocument();
    expect(screen.getByLabelText(/E-mail/)).toHaveAttribute("aria-invalid", "true");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("shows the server's generic error message on failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { code: "INVALID_CREDENTIALS", message: "Invalid e-mail or password.", request_id: "r1" },
    }), { status: 401, headers: { "Content-Type": "application/json" } })));
    render(<LoginForm redirectPath="/dashboard" />);

    await userEvent.type(screen.getByLabelText(/E-mail/), "admin@zestops.demo");
    await userEvent.type(screen.getByLabelText(/Password/), "wrong-password");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid e-mail or password.");
  });
});
