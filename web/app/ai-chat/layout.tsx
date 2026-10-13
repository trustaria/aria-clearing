import type { Metadata } from "next";
import { NOVA_ICONS } from "../../lib/brand-icons";

const APP_NAME = "Nova";
const APP_TITLE_TEMPLATE = "%s - Nova";
const APP_DESCRIPTION = "A chat assistant whose sponsored lines carry verifiable receipts.";

export const metadata: Metadata = {
  applicationName: APP_NAME,
  title: {
    absolute: APP_NAME,
    template: APP_TITLE_TEMPLATE,
  },
  description: APP_DESCRIPTION,
  manifest: "/manifest.json",
  icons: NOVA_ICONS,
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: APP_NAME,
  },
  other: {
    "mobile-web-app-capable": "yes",
  },
  formatDetection: {
    telephone: false,
  },
  openGraph: {
    type: "website",
    siteName: APP_NAME,
    title: {
      absolute: APP_NAME,
      template: APP_TITLE_TEMPLATE,
    },
    description: APP_DESCRIPTION,
  },
  twitter: {
    card: "summary",
    title: {
      absolute: APP_NAME,
      template: APP_TITLE_TEMPLATE,
    },
    description: APP_DESCRIPTION,
  },
};

export default function NovaLayout({ children }: { children: React.ReactNode }) {
  return children;
}
