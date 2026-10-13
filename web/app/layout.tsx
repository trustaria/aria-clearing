import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import DemoBar from "../components/DemoBar";
import { ARIA_ICONS } from "../lib/brand-icons";
import { DEMO_BAR_SCRIPT } from "../lib/demo-bar";
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
    // The head script may set data-demo-bar on <html> before hydration.
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: DEMO_BAR_SCRIPT }} />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <DemoBar />
        {children}
      </body>
    </html>
  );
}
