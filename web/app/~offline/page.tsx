import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Offline",
};

export default function Page() {
  return (
    <>
      <h1>You are offline</h1>
      <h2>Reconnect to keep chatting with Nova.</h2>
    </>
  );
}
