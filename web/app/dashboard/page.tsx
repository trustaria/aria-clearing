import type { Metadata } from "next";
import Dashboard from "../../components/dashboard/Dashboard";
import { deployment } from "../../lib/deployment";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Aria for publishers",
};

export default function DashboardPage() {
  return (
    <main className="min-h-screen bg-[#faf9f6] text-stone-900">
      <div className="mx-auto max-w-3xl px-6 py-14 sm:py-20">
        <Dashboard clearing={deployment().clearing} />
      </div>
    </main>
  );
}
