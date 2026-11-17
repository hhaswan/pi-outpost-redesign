import { X509Certificate } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createSecureContext, type Server } from "node:tls";
import type { Socket } from "node:net";
import type { ServerOptions } from "node:https";
import type { AppConfig } from "./config.ts";

/** Read once at startup; a TLS failure never selects a plaintext fallback. */
export async function listenerTls(config: Pick<AppConfig, "tls">): Promise<ServerOptions | undefined> {
  if (!config.tls) return undefined;
  const { certFile, keyFile } = config.tls;
  let cert: Buffer;
  let key: Buffer;
  try {
    [cert, key] = await Promise.all([readFile(certFile), readFile(keyFile)]);
  } catch {
    throw new Error("Cannot read server.tls certificate/key files; check the configured paths and service-account permissions.");
  }
  try {
    const certificate = new X509Certificate(cert);
    const now = Date.now();
    if (Date.parse(certificate.validFrom) > now || Date.parse(certificate.validTo) <= now) {
      throw new Error("certificate outside validity period");
    }
    const options: ServerOptions = { cert, key, minVersion: "TLSv1.2" };
    // Node checks PEM parsing and certificate/private-key agreement here, before listen.
    createSecureContext(options);
    return options;
  } catch {
    // OpenSSL diagnostics are deliberately not forwarded: no input key bytes in errors.
    throw new Error("Invalid server.tls certificate/key pair: use matching PEM files with a currently valid certificate. HTTPS startup refused; no HTTP fallback.");
  }
}

/** The public CA certificate named by `server.tls.caFile`, as the /ca routes serve it. */
export interface PublicCa {
  pem: string;
  der: Buffer;
  /** SHA-256 of the DER bytes, colon-separated upper-case hex. */
  fingerprint: string;
  validTo: string;
}

/**
 * Read and check `server.tls.caFile` before anything listens. A file holding private key
 * material, or a certificate that is not a CA, refuses startup: the routes serving it are public.
 */
export async function readPublicCa(caFile: string): Promise<PublicCa> {
  let text: string;
  try {
    text = await readFile(caFile, "utf8");
  } catch {
    throw new Error("Cannot read server.tls.caFile; check the configured path and service-account permissions.");
  }
  // Checked on the text, before parsing: the message must never carry the key.
  if (/PRIVATE KEY/.test(text)) {
    throw new Error("server.tls.caFile contains a private key. Name the CA certificate only (ca.crt), never ca.key. HTTPS startup refused.");
  }
  let certificate: X509Certificate;
  try {
    certificate = new X509Certificate(text);
  } catch {
    throw new Error("server.tls.caFile is not a PEM certificate. HTTPS startup refused.");
  }
  if (!certificate.ca) throw new Error("server.tls.caFile is not a CA certificate (no CA basic constraint). HTTPS startup refused.");
  const der = certificate.raw;
  return { pem: certificate.toString(), der, fingerprint: certificate.fingerprint256, validTo: certificate.validTo };
}

/** Whole days until the serving certificate expires. */
export async function certificateDaysLeft(certFile: string, now = Date.now()): Promise<number> {
  const certificate = new X509Certificate(await readFile(certFile));
  return Math.ceil((Date.parse(certificate.validTo) - now) / 86_400_000);
}

/** Host names and addresses the serving certificate names in its SAN. */
export async function certificateHosts(certFile: string): Promise<string[]> {
  const san = new X509Certificate(await readFile(certFile)).subjectAltName ?? "";
  return san.split(/,\s*/).map((entry) => entry.replace(/^(DNS|IP Address):/, "")).filter(Boolean);
}

const PLAIN_HEAD_LIMIT = 8 * 1024;
const PLAIN_HEAD_TIMEOUT_MS = 5_000;
const HOST_HEADER = /^([A-Za-z0-9.-]+|\[[0-9A-Fa-f:.]+\])(?::(\d{1,5}))?$/;

/**
 * Plain HTTP arriving on the TLS port gets one fixed answer and is closed: a 301 to
 * `https://<Host>/` for a host this server answers to, else a 400. The first byte decides:
 * 0x16 opens every TLS handshake. Path and query are never read into the answer or a log,
 * and no route runs over plaintext.
 */
export function installPlainHttpRedirect(server: Server, hostAllowed: (hostname: string) => boolean): void {
  const tlsListeners = server.listeners("connection") as ((socket: Socket) => void)[];
  server.removeAllListeners("connection");
  server.on("connection", (socket: Socket) => {
    socket.on("error", () => socket.destroy());
    socket.once("readable", () => {
      const first = socket.read(1) as Buffer | null;
      if (first === null) {
        socket.destroy();
        return;
      }
      socket.unshift(first);
      if (first[0] === 0x16) {
        for (const listener of tlsListeners) listener.call(server, socket);
        return;
      }
      answerPlainHttp(socket, hostAllowed);
    });
  });
}

function answerPlainHttp(socket: Socket, hostAllowed: (hostname: string) => boolean): void {
  let head = Buffer.alloc(0);
  const timer = setTimeout(() => socket.destroy(), PLAIN_HEAD_TIMEOUT_MS);
  let answered = false;
  const respond = () => {
    if (answered) return;
    answered = true;
    clearTimeout(timer);
    socket.removeAllListeners("data");
    const text = head.toString("latin1");
    const host = /\r\nhost:[ \t]*([^\r\n]*)/i.exec(text)?.[1]?.trim() ?? "";
    const match = HOST_HEADER.exec(host);
    const hostname = match?.[1]?.replace(/^\[|\]$/g, "");
    const ok = match !== null && hostname !== undefined && (match[2] === undefined || Number(match[2]) <= 65535) && hostAllowed(hostname);
    socket.end(
      ok
        ? `HTTP/1.1 301 Moved Permanently\r\nLocation: https://${host}/\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`
        : "HTTP/1.1 400 Bad Request\r\nContent-Type: text/plain\r\nContent-Length: 27\r\nConnection: close\r\n\r\nThis port speaks HTTPS only",
    );
  };
  socket.on("data", (chunk: Buffer) => {
    head = Buffer.concat([head, chunk]).subarray(0, PLAIN_HEAD_LIMIT);
    if (head.includes("\r\n\r\n") || head.length >= PLAIN_HEAD_LIMIT) respond();
  });
  socket.on("end", respond);
}
