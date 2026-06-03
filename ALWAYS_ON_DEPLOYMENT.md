# Always-On Backend Deployment

This project can run on an always-on host so Meta webhook processing does not depend on Vercel serverless cold starts.

If you want to keep the public Vercel webhook URL unchanged, this repo now supports that too:
- Meta continues calling the current Vercel `/api/meta/webhook`
- Vercel can forward the webhook internally to an always-on backend
- no Meta callback URL change is required
- no Meta form/page settings need to change

## Recommended host

Use `Render` for the backend. It is the simplest fit for this repo because:
- the app is already a standard Express server
- MongoDB Atlas is already being used
- Render supports a persistent web service with a health check

## Files added for deployment

- `Dockerfile`: container build for the Express app
- `.dockerignore`: trims Docker build context
- `render.yaml`: one-click Render service definition

## Deploy steps

1. Push this repo to GitHub.
2. In Render, create a new `Blueprint` deployment from the repo.
3. Render will detect `render.yaml`.
4. Set the secret env var:
   - `MONGODB_URI`
5. Confirm the non-secret env vars:
   - `MONGODB_DB_NAME=i-crm-workshop`
   - `MONGODB_STATE_COLLECTION=app_state`
   - `MONGODB_SESSION_COLLECTION=user_sessions`
   - `MONGODB_PREFERENCE_COLLECTION=user_preferences`
   - `MONGODB_META_CONFIG_COLLECTION=meta_config`
   - `MONGODB_META_LOGS_COLLECTION=meta_logs`
6. Deploy the service.
7. After deployment, open:
   - `https://<your-render-domain>/api/ping`
   You should get `{"ok":true}`.
8. Choose one webhook mode:
   - `Keep current Meta webhook URL on Vercel`
     Set the Vercel env var `META_WEBHOOK_FORWARD_URL=https://<your-render-domain>/api/meta/webhook`
   - `Move Meta webhook URL directly to Render`
     Update Meta to `https://<your-render-domain>/api/meta/webhook`
9. If you keep the Vercel URL, no Meta-side verification or field changes are needed.
10. If you move the public webhook URL to Render, re-verify the webhook using the same verify token already stored in the app.

## Frontend options

You now have two valid deployment shapes:

- move the full app to Render
- keep the frontend elsewhere and point it to the Render backend

The app now supports a configurable API base URL. It checks these in order:

1. `window.__DV_API_BASE_URL`
2. `<meta name="dv-api-base-url" content="https://your-backend">`
3. `localStorage.dvApiBaseUrl`

Example for a split setup:

```html
<meta name="dv-api-base-url" content="https://your-render-domain.onrender.com">
```

Or, for a quick test in the browser console:

```js
localStorage.setItem("dvApiBaseUrl", "https://your-render-domain.onrender.com");
location.reload();
```

For your case, the lowest-risk setup is:
- keep the existing Vercel public URL
- deploy the always-on backend to Render
- set `META_WEBHOOK_FORWARD_URL` on Vercel to the Render webhook endpoint

That gives you always-on processing without changing the Meta configuration.

## Post-deploy checklist

- Log in to the CRM on the new domain
- Open Meta Integration and confirm config is present
- Send a test lead from Meta
- Confirm the lead appears even when no CRM tab is open
- Watch the webhook logs for 10-15 minutes to confirm timeout errors stop
