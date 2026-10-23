/**
 * Who the signed-in user is — **replace this with your own auth** (NextAuth `auth()`, Clerk
 * `currentUser()`, Supabase `getUser()`, …). Every run acts as this user, with the accounts they
 * connected, and is billed to your key, so it must come from your session, never from the request.
 *
 * For a local try-out only, `LIGAX_DEMO_USER=<any id>` signs everyone in as that one user. It is
 * ignored in production builds, so a deployed copy of this example answers 401 until real auth is
 * wired in.
 */
export async function currentUser(
  _request: Request,
): Promise<{ id: string; name?: string } | null> {
  const demo = process.env.LIGAX_DEMO_USER?.trim();
  if (demo && process.env.NODE_ENV !== 'production') return { id: demo, name: 'Demo user' };
  return null;
}
