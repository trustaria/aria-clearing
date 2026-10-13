import type { Metadata } from "next";
import { ARIA_ICONS } from "../../lib/brand-icons";
import PrivyProvider from "../components/privy-provider";

export const metadata: Metadata = {
  title: "Aria for advertisers",
  icons: ARIA_ICONS,
};

// Privy wraps the advertiser console with its own sign-in copy.
export default function AdvertiseLayout({ children }: { children: React.ReactNode }) {
  return (
    <PrivyProvider landingHeader="Sign in to Aria" loginMessage="Advertise inside AI answers">
      {children}
    </PrivyProvider>
  );
}
