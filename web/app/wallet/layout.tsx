import PrivyProvider from "../components/privy-provider";

// Privy wraps only the pages that need a wallet, so the chat works without a Privy app id.
export default function WalletLayout({ children }: { children: React.ReactNode }) {
  return <PrivyProvider>{children}</PrivyProvider>;
}
