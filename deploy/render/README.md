# Test deployment on Render

One Blueprint (`render.yaml` at the repo root) creates everything on Render's free plans:

| Render resource | What it runs |
|---|---|
| `travelpal` (web) | The web app and core-api in one service, so they share one address |
| `travelpal-ai` (web) | The AI service (Claude, Voyage). Its `/internal` endpoints only accept tokens signed by `travelpal` |
| `travelpal-redis` (Key Value) | Rate limits, AI quotas, signed-out sessions, live updates |
| `travelpal-db` (Postgres) | All data. Tables are created on first start |

Differences from the AWS setup in `infra/`:
- There is no SQS on Render. The optimizer is called directly over HTTP (`OPTIMIZE_QUEUE=http`).
- The web app is served by core-api instead of CloudFront.

Both of these are configuration choices; the code is the same.

## Steps

1. **Make the keys** (on your machine):

   ```bash
   deploy/render/make-keys.sh
   ```

   This writes `deploy/render/keys.local.env`, which is gitignored and readable only by you.

2. **Create the Blueprint.** In the Render dashboard, go to **New > Blueprint**, pick this repository, then pick the branch. Render asks for these values once:

   | Key | Value |
   |---|---|
   | `JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY`, `INTERNAL_JWT_PRIVATE_JWK` | from `keys.local.env` |
   | `INTERNAL_JWT_PUBLIC_KEY` | from `keys.local.env` (for `travelpal-ai`) |
   | `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY` | your API keys |
   | `AI_SERVICE_URL` | `https://travelpal-ai.onrender.com` |

   If Render gives the AI service a different address (it adds a suffix when the name is taken), set `AI_SERVICE_URL` to that address afterwards.

3. **Delete the keys file:**

   ```bash
   rm deploy/render/keys.local.env
   ```

4. **Open the app.** Open `https://travelpal.onrender.com` (or the address Render shows) and create an account.

## Things to know about free plans

- **Sleeping services:** a service sleeps after 15 minutes without traffic, and the first request after that takes about a minute.
  - If the AI service is asleep, the first AI action may say it's unavailable. Try again a minute later.
- **Database expiry:** free Postgres databases expire after 30 days. Upgrade the plan in `render.yaml` to keep the data.
- **One instance:** each service runs one instance. Live updates and limits already go through Redis, so moving to more instances later only needs a plan change.

## Checking it

Run through this with two browsers, or one normal window and one private window:

1. Create an account, create a trip and add a few places.
2. Click **Invite** and copy the link.
3. In the other browser, open the link, create a second account and join the trip.
4. Add a place as the friend. It appears for the first person without a reload.
5. Click **Optimize Trip**, wait for the preview, then apply it.
