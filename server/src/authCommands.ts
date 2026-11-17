/**
 * `pi-outpost tls init|renew`, `pi-outpost token rotate` and `pi-outpost sessions revoke-all`.
 * Each edits files only; the running server picks session changes up from disk and the
 * rest at its next start.
 */
import { randomBytes } from "node:crypto";
import path from "node:path";
import { SessionStore } from "./authSessions.ts";
import { type AppConfig, ConfigWriteError, persistEditableSettings, userConfigDir } from "./config.ts";
import { initLocalCa, LocalCaError, renewServerCertificate } from "./localCa.ts";

export interface AuthCommand {
  command: "tls" | "token" | "sessions";
  action?: string;
  ips: string[];
  dns: string[];
  revokeSessions: boolean;
  /** `tls init --new-ca`: replace an existing CA. */
  newCa?: boolean;
}

export function sessionStoreFile(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(userConfigDir(env), "sessions.json");
}

/** Why the token cannot be rotated here, or undefined when it can. */
export function rotationRefusal(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (env.PI_OUTPOST_TOKEN !== undefined) return "The token comes from PI_OUTPOST_TOKEN; change that variable instead.";
  return undefined;
}

export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export async function runAuthCommand(
  command: AuthCommand,
  config: AppConfig,
  out: (line: string) => void = console.log,
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  try {
    if (command.command === "tls") {
      const options = { host: config.host, ips: command.ips, dns: command.dns };
      let files;
      if (command.action === "init") {
        const result = await initLocalCa(userConfigDir(env), { ...options, newCa: command.newCa });
        files = result.files;
        if (result.replacedCaBackup) {
          out(`[pi] WARNING: replaced the local CA. Every device must install and trust the new CA again (open https://<host>:<port>/ca).`);
          out(`[pi] the previous CA was moved to ${result.replacedCaBackup}`);
        }
        out(
          result.reusedCa
            ? `[pi] reused the existing local CA in ${files.dir}; devices that trust it need nothing new`
            : `[pi] created a local CA in ${files.dir}`,
        );
        out(result.issuedServer ? "[pi] issued a server certificate from it" : "[pi] kept the existing server certificate (valid for more than 30 days)");
      } else {
        files = await renewServerCertificate(userConfigDir(env), options);
        out(`[pi] issued a new server certificate from the existing CA in ${files.dir}; the CA is unchanged`);
      }
      persistEditableSettings(config, { serverTls: { certFile: files.serverCert, keyFile: files.serverKey, caFile: files.caCert } }, env);
      out(`[pi] wrote server.tls to ${config.configFile} (the CA key is not named there)`);
      out("[pi] restart pi-outpost to use it");
      return 0;
    }
    if (command.command === "token") {
      const refusal = rotationRefusal(env);
      if (refusal) throw new ConfigWriteError(refusal);
      const token = newToken();
      persistEditableSettings(config, { serverToken: token }, env);
      if (command.revokeSessions) new SessionStore(sessionStoreFile(env)).removeAll();
      out(`[pi] wrote a new server.token to ${config.configFile}. It is shown once:`);
      out(token);
      out(`[pi] restart pi-outpost to use it${command.revokeSessions ? "; every browser session was revoked" : ""}`);
      return 0;
    }
    new SessionStore(sessionStoreFile(env)).removeAll();
    out("[pi] revoked every browser session; a running server closes their connections within 15 seconds");
    return 0;
  } catch (error) {
    if (error instanceof LocalCaError || error instanceof ConfigWriteError) {
      console.error(`[pi] ${error.message}`);
      return 1;
    }
    throw error;
  }
}
