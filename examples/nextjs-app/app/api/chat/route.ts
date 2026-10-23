import { createRunRoute } from '@ligaxai/sdk/next';

import { currentUser } from '../../../lib/session';

/**
 * The only server code that runs agents, and the only place the secret key is used: the SDK reads
 * `LIGAX_API_KEY` (and `LIGAX_BASE_URL` for a non-production platform) from the server environment.
 * Never expose either to the browser — no `NEXT_PUBLIC_` prefix.
 *
 * The profile is pinned here, not chosen by the browser, and every run is for the signed-in user
 * from `currentUser` — a visitor who is not signed in gets 401. Put a spend limit on the key and a
 * rate limit in front of this route before you deploy it.
 */
let handler: ReturnType<typeof createRunRoute> | undefined;

export async function POST(request: Request): Promise<Response> {
  if (!process.env.LIGAX_PROFILE_ID) {
    return Response.json(
      { error: { message: 'Set LIGAX_PROFILE_ID to a prf_… id from Settings → Developers.' } },
      { status: 500 },
    );
  }
  handler ??= createRunRoute({
    profileId: process.env.LIGAX_PROFILE_ID,
    resolveEndUser: currentUser,
  });
  return handler.POST(request);
}
