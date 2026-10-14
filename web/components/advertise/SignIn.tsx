import { demoLogin } from "../../lib/demo-login";
import TestLogin from "../TestLogin";
import { Eyebrow, PRIMARY } from "./ui";

/** Signed-out landing for the advertiser console. */
export default function SignIn({ onLogin, ready }: { onLogin: () => void; ready: boolean }) {
  return (
    <div className="space-y-8">
      <Eyebrow />
      <div className="space-y-3">
        <h1 className="font-serif text-[2rem] leading-snug text-stone-900">Get recommended inside AI answers.</h1>
        <p className="max-w-prose text-[15px] leading-relaxed text-stone-600">
          Tell us what you sell, approve what the AI may say about it, and pay only for impressions and clicks that pass
          verification.
        </p>
      </div>
      <div className="space-y-3">
        <button type="button" onClick={onLogin} disabled={!ready} className={PRIMARY}>
          {ready ? "Sign in with email" : "Loading…"}
        </button>
        <p className="text-sm text-stone-500">We email you a one-time code. No password.</p>
      </div>
      <TestLogin login={demoLogin()} note="Its wallet gets test USDC and MON for a campaign; it is shared, so you will see campaigns other visitors launched." />
    </div>
  );
}
