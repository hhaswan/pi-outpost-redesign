import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { TokenGate } from "./TokenGate";

function renderGate(props?: Record<string, unknown>) {
  const mockOnSubmit = vi.fn(async () => null as string | null);
  const result = render(<TokenGate onSubmit={mockOnSubmit} {...(props as any)} />);
  return { ...result, mockOnSubmit };
}

describe("TokenGate (sign-in screen)", () => {
  it("renders the token form", () => {
    renderGate();
    expect(screen.getByLabelText("Access token")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect" })).toBeDisabled();
    expect(screen.getByText("π")).toBeInTheDocument();
  });

  it("displays a custom title", () => {
    renderGate({ title: "Custom Title" });
    expect(screen.getByText("Custom Title")).toBeInTheDocument();
  });

  it("SignInWithToken: submits the trimmed token once, however often it is clicked", async () => {
    let resolve!: (value: string | null) => void;
    const onSubmit = vi.fn(() => new Promise<string | null>((r) => (resolve = r)));
    render(<TokenGate onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText("Access token"), { target: { value: " test-token " } });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith("test-token");
    resolve(null);
    await waitFor(() => expect(screen.getByRole("button", { name: "Connect" })).toBeEnabled());
  });

  it("shows why a sign-in was refused", async () => {
    renderGate({ onSubmit: vi.fn(async () => "That token is not correct.") });
    fireEvent.change(screen.getByLabelText("Access token"), { target: { value: "bad" } });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That token is not correct.");
  });

  it("offers a pairing code when the app can redeem one", async () => {
    const onSubmitCode = vi.fn(async () => null);
    renderGate({ onSubmitCode });
    fireEvent.change(screen.getByLabelText("Pairing code"), { target: { value: "abcde-fghjk" } });
    fireEvent.click(screen.getByRole("button", { name: "Pair this device" }));
    await waitFor(() => expect(onSubmitCode).toHaveBeenCalledWith("abcde-fghjk"));
  });

  it("CaLinkedFromSignInAndSettings: links to /ca when the server serves its CA", () => {
    renderGate({ caAvailable: true });
    expect(screen.getByRole("link", { name: "Install this server's certificate" })).toHaveAttribute("href", "/ca");
  });

  it("says a ?token= link was ignored, and shows a failed pairing link", () => {
    renderGate({ urlTokenIgnored: true, pairingError: "That code is wrong, used or expired. Create a new one." });
    expect(screen.getByRole("status")).toHaveTextContent("no longer sign in");
    expect(screen.getByRole("alert")).toHaveTextContent("expired");
  });

  it("input has type password and autocomplete off", () => {
    renderGate();
    const input = screen.getByLabelText("Access token") as HTMLInputElement;
    expect(input.type).toBe("password");
    expect(input.autocomplete).toBe("off");
  });
});
