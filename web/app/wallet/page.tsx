import type { Metadata } from "next";

import UseLoginPrivy from "../components/UseLoginPrivy";

export const metadata: Metadata = {
  title: "Wallet",
};

export default function Page() {
  return <UseLoginPrivy />;
}
