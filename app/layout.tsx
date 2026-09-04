import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  applicationName: "HomeRelay",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "HomeRelay",
  },
  title: "HomeRelay",
  description: "写真と声で、次の人へ温かくバトンを渡す申し送りWebアプリ",
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#FAF8F3",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
