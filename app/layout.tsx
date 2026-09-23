import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SlotPilot · Book your next service",
  description: "Voice-assisted car service booking with clear constraints and real confirmations.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
