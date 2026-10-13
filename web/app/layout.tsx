import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { ARIA_ICONS } from "../lib/brand-icons";
import "./globals.css";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

const DESCRIPTION =
  "Clearing for sponsored AI answers: every sponsored line has a receipt, verified by Chainlink, settled on Monad.";

export const metadata: Metadata = {
  title: "Aria Clearing",
  description: DESCRIPTION,
  icons: ARIA_ICONS,
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "transparent" },
    { media: "(prefers-color-scheme: dark)", color: "transparent" }
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
