# i-CRM Workshop Lead Platform

Last updated: 2026-06-24

`i-crm-workshop` is the current workshop lead-management platform in this folder. It has grown into a multi-screen operations app for pre-workshop, post-workshop, counselor, candidate, task, monitoring, and course-registration workflows, backed by a Node/Express server and MongoDB.

## Current functionality
- Admin authentication and session handling
- Lead state storage and reset flows
- Lead activity logging, notes, and assignment updates
- Counselor and allocation management
- Notifications and notification-read tracking
- Task creation, update, and deletion
- Pre-workshop and post-workshop operations screens
- Lost-leads tracking
- Registered-candidates workflow
- Course catalog and public course registration routing
- Meta integration configuration, webhook intake, retry, and log review
- MCUBE calling integration configuration, outbound click-to-call, inbound call-event sync, and log review
- Monitoring and ping/warm endpoints
- Admin backup and restore actions
- Version endpoint and UI state/preferences persistence

## Current UI pages
- `index.html` - login / entry page
- `dashboard.html` - main operations dashboard
- `pre-workshop.html`
- `post-workshop.html`
- `lead-control.html`
- `lost-leads.html`
- `registered-candidates.html`
- `courses.html`
- `counselor-management.html`
- `task-tracker.html`
- `monitoring.html`
- `meta-integration.html`
- `mcube-integration.html`

## Important API areas in the current build
- Auth: `/api/auth/login`, `/api/auth/session`, `/api/auth/logout`
- Leads: `/api/leads`, `/api/leads/:leadId/activity`, `/api/leads/:leadId/notes`, `/api/leads/assignment`
- Tasks: `/api/tasks`, `/api/tasks/:taskId`
- State and preferences: `/api/state`, `/api/state/reset`, `/api/preferences/:scope`
- Counselors and allocation: `/api/counselors`, `/api/allocation`
- Notifications: `/api/notifications`, `/api/notifications/read`
- Public course flows: `/api/public-course-registrations`, `/api/public-course-routing`
- Meta integration: `/api/meta/config`, `/api/meta/webhook`, `/api/meta/logs`, `/api/meta/retry-jobs`, `/api/meta/rr-state/reset`
- MCUBE integration: `/api/mcube/config`, `/api/mcube/test`, `/api/mcube/logs`, `/api/mcube/lookup`, `/api/mcube/click-to-call`, `/api/mcube/webhook`, `/api/mcube/rr-state/reset`
- Admin utilities: `/api/admin/backup`, `/api/admin/restore`
- Ops health: `/api/ping`, `/api/warm`, `/api/version`

## MCUBE setup notes
- Inbound call events should post to the CRM webhook URL shown on `mcube-integration.html`, which resolves to `/api/mcube/webhook`.
- The inbound mapper supports MCUBE fields `starttime`, `callid`, `emp_phone`, `clicktocalldid`, `callto`, `dialstatus`, `filename`, `direction`, `endtime`, `disconnectedby`, `answeredtime`, `groupname`, and `agentname`.
- Outbound click-to-call defaults to `https://api.mcube.com/Restmcube-api/outbound-calls` with method `POST`.
- The outbound request body follows MCUBE's documented shape: `HTTP_AUTHORIZATION`, `exenumber`, `custnumber`, `refurl`, and optional `refid`.
- `exenumber` comes from the assigned counselor's MCUBE/executive/phone number, then the active session, then the MCUBE fallback executive number.

## Scripts
```bash
npm start
npm run dev
npm test
npm run init-db
npm run clear-leads
```

Additional maintenance scripts live in `scripts/` for backup, export, migration, duplicate-lead handling, and database initialization tasks.

## Local development
Prerequisites:
- Node.js
- MongoDB access configured in `.env`

Install dependencies:
```bash
npm install
```

Start locally:
```bash
npm start
```

## Notes
- This is no longer just a simple workshop landing project; it is an operations-heavy internal platform with multiple workflow pages and integration surfaces.
- There is a regression test in `tests/stability-regression.test.js` and several maintenance scripts that support day-to-day operations.
