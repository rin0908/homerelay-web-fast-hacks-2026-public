"use client";

import { useSyncExternalStore } from "react";

declare global {
  interface Navigator {
    standalone?: boolean;
  }
}

export function IphoneInstallHint() {
  const visible = useSyncExternalStore(
    (onChange) => {
      const media = window.matchMedia("(display-mode: standalone)");
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    },
    () => {
      const isIphone = /iPhone/i.test(navigator.userAgent);
      const isStandalone =
        navigator.standalone === true ||
        window.matchMedia("(display-mode: standalone)").matches;
      return isIphone && !isStandalone;
    },
    () => false,
  );

  if (!visible) return null;

  return (
    <aside
      className="mt-4 rounded-2xl border border-[#c8d9d3] bg-[#edf5f1] px-4 py-3 text-sm text-[var(--color-heading)]"
      role="note"
    >
      <span className="font-semibold">URLバーなしで使う：</span>
      Safariの共有ボタンから「ホーム画面に追加」を選んでください。
    </aside>
  );
}
