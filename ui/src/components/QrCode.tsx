import { useEffect, useState } from "react";

/**
 * A QR code of `text`, drawn as SVG squares. The encoder is loaded on first use: only
 * the Settings security section needs it.
 */
export function QrCode({ text, label, size = 168 }: { text: string; label: string; size?: number }) {
  const [modules, setModules] = useState<boolean[][] | null>(null);
  useEffect(() => {
    let cancelled = false;
    void import("qrcode-generator").then(({ default: qrcode }) => {
      if (cancelled) return;
      const qr = qrcode(0, "M");
      qr.addData(text);
      qr.make();
      const count = qr.getModuleCount();
      setModules(Array.from({ length: count }, (_, row) => Array.from({ length: count }, (_, col) => qr.isDark(row, col))));
    });
    return () => {
      cancelled = true;
    };
  }, [text]);
  if (!modules) return <div style={{ width: size, height: size }} className="rounded-xl bg-zinc-100 dark:bg-zinc-800" aria-hidden="true" />;
  const count = modules.length + 8;
  const path = modules.flatMap((row, y) => row.flatMap((dark, x) => (dark ? [`M${x + 4} ${y + 4}h1v1h-1z`] : []))).join("");
  return (
    <svg role="img" aria-label={label} data-qr-text={text} width={size} height={size} viewBox={`0 0 ${count} ${count}`} className="rounded-xl bg-white" shapeRendering="crispEdges">
      <path d={path} fill="#000" />
    </svg>
  );
}
