/** Verifies `Authorization: Bearer <Privy access token>`: the user id, or the error response to return. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function verifyAdvertiser(req: Request): Promise<{ userId: string } | Response> {
  throw new Error("not implemented");
}
