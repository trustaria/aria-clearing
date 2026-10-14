export type DemoLogin = { email: string; code: string };

/** The shared Privy test login for the demo; null unless both the email and the code are set. */
export function demoLogin(
  env: { email?: string; code?: string } = {
    email: process.env.NEXT_PUBLIC_DEMO_LOGIN_EMAIL,
    code: process.env.NEXT_PUBLIC_DEMO_LOGIN_CODE,
  },
): DemoLogin | null {
  const email = env.email?.trim();
  const code = env.code?.trim();
  return email && code ? { email, code } : null;
}
