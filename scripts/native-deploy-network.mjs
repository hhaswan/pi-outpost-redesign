/** Temporary ingress gate. Normal clients cannot submit during restart/restoration. */
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const DEPLOY_ADDRESS = "127.0.0.2";
function rules(port, ipv6) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error("Invalid deployment port");
  return ["-p", "tcp", "--dport", String(port),
    ...(!ipv6 ? ["!", "-s", DEPLOY_ADDRESS] : []),
    "-m", "comment", "--comment", `pi-outpost-custom-deploy-${port}`,
    "-j", "REJECT", "--reject-with", "tcp-reset"];
}
function run(ipv6, args) {
  return execFileSync(ipv6 ? "/usr/sbin/ip6tables" : "/usr/sbin/iptables", ["-w", "5", ...args], {
    encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "pipe"],
  });
}
export function unlockIngress(port) {
  const failures = [];
  for (const ipv6 of [false, true]) {
    const rule = rules(port, ipv6);
    try { run(ipv6, ["-C", "INPUT", ...rule]); }
    catch (error) {
      if (error.status === 1) continue; // The exact rule is already absent.
      failures.push(error); continue;
    }
    try { run(ipv6, ["-D", "INPUT", ...rule]); } catch (error) { failures.push(error); }
  }
  if (failures.length) throw Error("Could not remove the temporary deployment ingress gate", { cause: failures[0] });
}
export function lockIngress(port) {
  try {
    for (const ipv6 of [false, true]) run(ipv6, ["-I", "INPUT", "1", ...rules(port, ipv6)]);
  } catch (error) {
    unlockIngress(port);
    throw error;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] !== "unlock") throw Error("Usage: node scripts/native-deploy-network.mjs unlock <port>");
  unlockIngress(Number(process.argv[3]));
}
