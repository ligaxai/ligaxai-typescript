import { createRunRoute } from '@ligaxai/sdk/next';

/**
 * The only server code in the example, and the only place the secret key is used: the SDK reads
 * `LIGAX_API_KEY` (and `LIGAX_BASE_URL` for a non-production platform) from the server environment.
 * Never expose either to the browser — no `NEXT_PUBLIC_` prefix.
 *
 * The profile is pinned here, not chosen by the browser. Wire `resolveEndUser` to your own session
 * so each signed-in user gets their own conversations (and so a profile that requires an end user
 * works).
 */
const handler = createRunRoute({
  profileId: process.env.LIGAX_PROFILE_ID ?? '',
  resolveEndUser: () => undefined,
});

export async function POST(request: Request): Promise<Response> {
  if (!process.env.LIGAX_PROFILE_ID) {
    return Response.json(
      { error: { message: 'Set LIGAX_PROFILE_ID to a prf_… id from Settings → Developers.' } },
      { status: 500 },
    );
  }
  return handler.POST(request);
}
