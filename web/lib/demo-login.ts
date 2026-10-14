export type DemoLogin = { email: string; code: string };

/** The shared Privy test login for the publisher dashboard; null unless both the email and the code are set. */
export function demoPublisherLogin(
  env: { email?: string; code?: string } = {
    email: process.env.NEXT_PUBLIC_DEMO_PUBLISHER_EMAIL,
    code: process.env.NEXT_PUBLIC_DEMO_PUBLISHER_CODE,
  },
): DemoLogin | null {
  const email = env.email?.trim();
  const code = env.code?.trim();
  return email && code ? { email, code } : null;
}
