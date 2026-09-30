# SlotPilot · Main Web Application

A voice administrator for a demo car service workshop: services, constraints, mechanic and service bay selection, separate confirmation, and booking storage in PostgreSQL. The interface and voice interactions are in English. Branch timezone: Asia/Almaty.

## Current Status

This is the main application, replacing the earlier standalone probe. The client interface, P0/P1 server operations, PostgreSQL migration, voice adapter, and admin/demo features have been implemented. Scheduling also works without a database connection in an **explicitly labelled preview mode** that does not save anything.

On `main` (`a72386d`, after PRs [#9](https://github.com/NuraliKuzhagaliev/slotpilot/pull/9) and [#10](https://github.com/NuraliKuzhagaliev/slotpilot/pull/10)), 234/234 automated tests and TypeScript checks were rerun successfully. Both production builds (Next.js and Vinext) and the browser preview are documented in the results of PR #10; evidence and verification scope are recorded in [VERIFICATION_RU.md](docs/VERIFICATION_RU.md).

**Live voice assistant verification passed:** on September 30, 2026, the project owner personally tested the current version of SlotPilot and confirmed that voice interactions and the physical microphone work well. This confirmation comes from the owner's real use of the application. The migration has been applied to a real Supabase database; concurrent transactions, prevention of overlapping bookings, rollback, and environment isolation were verified earlier.

Public Vercel deployment: https://slotpilot-beta.vercel.app .

A free SlotPilot Supabase project was created in Lord Org (Frankfurt): `lylcxxdrpralrstxzuct`. The migration has been applied; server secrets for the database and test sign-in are configured in Sites. For your own copy, configure the server-side `ASSEMBLYAI_API_KEY` using the instructions below.

## Desktop Application

The project owner has also created a SlotPilot desktop application. It is planned to be uploaded to a separate repository: [SlotPilot-app](https://github.com/NuraliKuzhagaliev/SlotPilot-app).

## Running on Windows

Extract the project into a separate folder. Keep your previous working version. In VS Code, open the folder containing this README and package.json.

Node.js 22.16+ is required; the owner's Node.js 22.20 is suitable. In PowerShell:

```powershell
npx.cmd --yes pnpm@11.25.0 install --frozen-lockfile
npm.cmd run setup
```

To preserve your existing key and passwords, you can copy your old `.env.local` into the new folder **before running setup**. Setup only adds missing entries; it does not overwrite existing values or keys. Do not upload this file to GitHub or send it in chat.

Fill in the following values in `.env.local`:

```env
ASSEMBLYAI_API_KEY=
SUPABASE_URL=
SUPABASE_SECRET_KEY=
```

Setup only generates SESSION_SECRET. Set it manually if it is still empty; it must contain at least 32 characters. User passwords are managed in Supabase Auth; there is no separate demo administrator password.

Then run:

```powershell
npm.cmd run doctor
npm.cmd run dev:next
```

Open http://localhost:3000. In this version, `dev:next` runs standard Next.js. `dev` / `build` are retained for hosting through Sites (Vinext); they do not run the old probe.

Sign in with the email and password of a Supabase Auth account. There is no role selector or separate “admin” login. Standard registration grants client access; for `/admin` and `/demo`, the project owner must assign `{"role":"admin"}` to the account in **Supabase → Authentication → Users → App Metadata**. Then sign out and sign in again. Do not assign the role through User Metadata or add a role field to the public registration form.

**Before enabling the new sign-in flow on Vercel:** in Supabase Authentication → URL Configuration, set the Site URL to `https://slotpilot-beta.vercel.app` and allow the Redirect URL `https://slotpilot-beta.vercel.app/`. For local testing, also add `http://localhost:3000/`. In Supabase Authentication → SMTP Settings, connect your own SMTP service: the built-in SMTP only sends emails to project members, so other visitors will not be able to verify their email or reset their password without custom SMTP. If you use a different Supabase project, add the server variable `SUPABASE_PUBLISHABLE_KEY` from API Keys. Never expose the secret key to the browser.

## Supabase Database

The database for the deployed application has already been created and configured. The instructions below are for your own local copy; use a separate DEMO_NAMESPACE and fictional data only.

1. Run the entire `supabase/migrations/001_slotpilot.sql` file in the SQL Editor.
2. Store the project URL and Secret API key (the legacy SUPABASE_SERVICE_ROLE_KEY is also supported) only in `.env.local` or the hosting platform's server secrets.
3. Run `npm.cmd run doctor`, followed by `npm.cmd run test:db`.

`test:db` creates unique `slotpilot-test-*` namespaces and checks the real overlap constraint, two concurrent writes against the same revision, transaction rollback, and namespace independence. It then cleans up test resources; empty test documents remain. The working namespace is not changed. Without a database connection, the command exits with code 2 and reports BLOCKED rather than presenting a mock as a real database.

The catalog and reproducible initial occupancy are generated by the existing `demo-fixtures.ts` module, while all bookings, actions, and consent records are stored in PostgreSQL. The server checks actual availability again at confirmation.

## Main Demo

1. Select Centre and start a conversation in English. Consent to sharing audio with AssemblyAI.
2. “I need an oil change tomorrow for a petrol sedan. I can arrive after two. My budget is forty thousand tenge.”
3. Expected result: Centre, 15:00–15:45, 15,000 KZT.
4. Interrupt: “Wait, add a brake inspection and computer diagnostics. I need the car ready by four.”
5. The total is 120 minutes and 37,000 KZT; Centre cannot meet the constraints, so North, 14:00–16:00, is offered as a change to the conditions.
6. Allow North to be considered. Then separately confirm the complete visit details.
7. Check the saved booking, reload the page, and open `/admin` in another browser profile.

The form is an alternative to voice and uses the same server algorithm and operations. After preparation, the Confirm button confirms the exact booking snapshot. A simple “yes, but…” does not count as consent. Voice confirmation accepts only a narrow set of complete, unambiguous English phrases; use the button if the response is ambiguous.

## Tests and Build

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run typecheck:core
npm.cmd run demo:engine
npm.cmd run test:db
npm.cmd run build:next
```

The existing Node tests have been retained; new checks use the same runner. Vitest/Playwright suites have not yet been added. In PR #10, the browser preview was tested interactively: the landing page, navigation to `/book#assistant`, and three scheduling options. The voice-stall regression from PR #9 is covered by a replay of an anonymized incident and mock controller/audio tests. Separately, on September 30, 2026, the project owner successfully tested the live voice assistant and physical microphone.

Further details: [verification](docs/VERIFICATION_RU.md), [free hosting](docs/DEPLOYMENT_RU.md), [architecture](docs/ARCHITECTURE_RU.md), [criteria](docs/IMPLEMENTATION_STATUS_RU.md), and [team ownership](docs/TEAM_OWNERSHIP_RU.md).

`npm run test:integration` checks real HTTP route handlers with Supabase, without a mock database. By default, handlers are invoked within the Node process; set SLOTPILOT_TEST_BASE_URL to test a local server over HTTP. A separate DEMO_NAMESPACE=slotpilot-test-... is required: the test creates, reschedules, cancels, and resets test data only.
