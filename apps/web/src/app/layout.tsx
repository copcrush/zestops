import type { Metadata, Viewport } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: { default: "ZestOps", template: "%s · ZestOps" },
  description: "Secure financial operations & service monitoring platform (portfolio project, simulated payments).",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#C7E6A0",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
