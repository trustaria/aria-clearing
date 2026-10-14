import type { DemoLogin } from "../lib/demo-login";

/** The shared test login, shown under a sign-in button with a line on what the account is; nothing when none is set. */
export default function TestLogin({ login, note }: { login: DemoLogin | null; note: string }) {
  if (!login) return null;
  return (
    <div className="max-w-prose rounded-lg border border-stone-200 bg-white px-4 py-3 text-sm text-stone-600">
      <p className="font-medium text-stone-900">Trying the demo?</p>
      <p className="mt-1">
        Sign in with the test account: email <code className="font-mono text-stone-900">{login.email}</code>, one-time
        code <code className="font-mono text-stone-900">{login.code}</code>. No email is sent; type the code when asked.{" "}
        {note}
      </p>
    </div>
  );
}
