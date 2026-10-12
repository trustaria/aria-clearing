import Link from "next/link";

export default function Page() {
  return (
    <main className="max-w-2xl mx-auto px-4 py-16">
      <h1 className="text-2xl font-semibold">Nova</h1>
      <p className="mt-4">
        <Link href="/wallet" className="underline">
          Wallet
        </Link>
      </p>
    </main>
  );
}
