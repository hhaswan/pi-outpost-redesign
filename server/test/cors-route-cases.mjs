/** HTTP routes whose CORS behaviour is exercised by cors.test.mjs. */
export const HTTP_ROUTE_CASES = [
  { registration: "/branding", path: "/branding", label: "branding" },
  { registration: "/health", path: "/health", label: "health" },
  { registration: "/files/raw", path: "/files/raw?path=readme.md", label: "files/raw" },
  { registration: "/files/download", path: "/files/download?path=readme.md", label: "files/download" },
  { registration: "/api/session", path: "/api/session", label: "api/session" },
  { registration: "/ca", path: "/ca", label: "ca page" },
  { registration: "/ca.crt", path: "/ca.crt", label: "ca certificate" },
  { registration: "/ca.mobileconfig", path: "/ca.mobileconfig", label: "ca profile" },
  { registration: "/*", path: "/", label: "the static app" },
  { registration: "/pair", path: "/pair", label: "pairing page" },
];

/** The upgrade route is exercised as a WebSocket, not as an HTTP response. */
export const WEBSOCKET_ROUTE = "/ws";
