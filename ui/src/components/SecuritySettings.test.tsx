import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SecuritySettings } from "./SecuritySettings";

const session = { signedIn: true, authRequired: true, via: "session" as const, sessions: 2, ca: { fingerprint: "AA:BB:CC" }, canRotate: true };

function renderSecurity(overrides: Partial<Parameters<typeof SecuritySettings>[0]> = {}) {
  const props = {
    session,
    onSignOut: vi.fn(),
    onRotateToken: vi.fn(async () => ({ token: "new-token-value" })),
    onCreatePairingCode: vi.fn(async () => ({ code: "ABCDE-FGHJK", expiresAt: Date.now() + 120_000 })),
    ...overrides,
  };
  render(<SecuritySettings {...props} />);
  return props;
}

describe("SecuritySettings", () => {
  it("CaLinkedFromSignInAndSettings: shows the CA fingerprint and a QR code of https://<host>/ca", async () => {
    renderSecurity();
    expect(screen.getByTestId("ca-fingerprint")).toHaveTextContent("AA:BB:CC");
    const qr = await screen.findByRole("img", { name: "QR code of the certificate install page" });
    expect(qr.getAttribute("data-qr-text")).toBe(`https://${window.location.host}/ca`);
    expect(qr.querySelector("path")!.getAttribute("d")!.length).toBeGreaterThan(100);
  });

  it("QrPairing: a pairing QR of <this origin>/pair#<code> (http before the cutover), the typed code and a countdown", async () => {
    const props = renderSecurity();
    fireEvent.click(screen.getByRole("button", { name: "Create code" }));
    const qr = await screen.findByRole("img", { name: "QR code to pair a device" });
    expect(props.onCreatePairingCode).toHaveBeenCalledTimes(1);
    expect(qr.getAttribute("data-qr-text")).toBe(`${window.location.origin}/pair#ABCDE-FGHJK`);
    expect(screen.getByTestId("pairing-code")).toHaveTextContent("ABCDE-FGHJK");
    expect(screen.getByTestId("pairing-code")).toHaveTextContent(/1[12]\d s left, single use/);
  });

  it("PlainHttpSessionUntilCutover: a page on http shows one 'Not encrypted' notice with the HTTPS docs link", () => {
    expect(window.location.protocol).toBe("http:");
    renderSecurity();
    const notice = screen.getByTestId("plain-http-notice");
    expect(notice).toHaveTextContent("Not encrypted — set up HTTPS (docs)");
    const link = screen.getByRole("link", { name: "docs" });
    expect(link).toHaveAttribute("href", expect.stringContaining("docs/deployment.md#remote-transport-https-or-ssh"));
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("SignOutAndRevocation: the session count, Sign out and Sign out all devices", () => {
    const props = renderSecurity();
    expect(screen.getByTestId("session-count")).toHaveTextContent("2 browsers signed in");
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(props.onSignOut).toHaveBeenCalledWith(false);
  });

  it("Sign out all devices asks the server to revoke every session", async () => {
    const props = renderSecurity();
    fireEvent.click(screen.getByRole("button", { name: "Sign out all devices" }));
    await waitFor(() => expect(props.onSignOut).toHaveBeenCalledWith(true));
  });

  it("TokenRotation: shows the new token once, after confirmation, revoking others by default", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const props = renderSecurity();
    fireEvent.click(screen.getByRole("button", { name: "Rotate token" }));
    expect(await screen.findByTestId("rotated-token")).toHaveTextContent("new-token-value");
    expect(props.onRotateToken).toHaveBeenCalledWith(true);
  });

  it("shows why a rotation was refused", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderSecurity({ onRotateToken: vi.fn(async () => ({ error: "The token comes from PI_OUTPOST_TOKEN; change that variable instead." })) });
    fireEvent.click(screen.getByRole("button", { name: "Rotate token" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("PI_OUTPOST_TOKEN");
  });

  it("ExpiryWarning: Settings says when the server certificate has under 30 days left", () => {
    renderSecurity({ session: { ...session, certificateDaysLeft: 20 } });
    expect(screen.getByTestId("certificate-expiry")).toHaveTextContent("expires in 20 days");
    expect(screen.getByTestId("certificate-expiry")).toHaveTextContent("pi-outpost tls renew");
  });

  it("no expiry notice while the certificate has 30 days or more", () => {
    renderSecurity({ session: { ...session, certificateDaysLeft: 300 } });
    expect(screen.queryByTestId("certificate-expiry")).toBeNull();
  });

  it("offers no rotation when the server cannot rotate, and no Sign out for a Bearer client", () => {
    renderSecurity({ session: { ...session, canRotate: false, via: "bearer" } });
    expect(screen.queryByRole("button", { name: "Rotate token" })).toBeNull();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeDisabled();
  });
});
