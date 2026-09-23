# SlotPilot development instructions

Read docs/SPEC_RU.md, ARCHITECTURE_RU.md, IMPLEMENTATION_STATUS_RU.md, TEAM_OWNERSHIP_RU.md and CURRENT_TASK_RU.md.

User authorizes full implementation and free hosting. A live stage-0 probe was confirmed by the user; they reported slow interruption. Supabase project lylcxxdrpralrstxzuct is configured in Lord Org on Free. Native tools are now available. Real PostgreSQL concurrency, exclusion, rollback and namespace tests passed. Full P0 is not accepted: the new voice booking still requires the server AssemblyAI key and a live microphone test. Do not request another Supabase connection. LLM Gateway optional; deadline unknown. User explicitly authorized creating free Supabase if needed, but provider sign-in/terms must follow applicable approval rules. Never create paid resources.

Preserve existing code, contracts, pnpm-lock.yaml and Sites identity. The site uses Next App Router with a Vinext hosting build. Ordinary Next.js commands are dev:next and build:next. No permanent secrets in frontend, source, logs, archives or chat. Real .env.local is ignored; .env.example is committed without values. Setup preserves old values.

Only integrator B changes contracts/root config; A owns booking/admin UI; C owns domain/data/migrations. Do not silently replace PostgreSQL with localStorage, SQLite or memory. Preview mode must remain clearly labelled and non-persistent.

175 tests currently pass. Run npm test, npm run typecheck and a relevant build after changes. npm run test:db uses real Supabase/PostgreSQL and exits BLOCKED when missing; never count it as passed. Voice mocks do not validate real API, microphone or audible interruption latency.

Treat actionId and exact consent evidence as mandatory. Partial transcripts never confirm. Audio interruption cannot cancel a database commit; reconcile by actionId. Native exclusion constraints and revision CAS must stay in the same database transaction as operation results and both resources. Keep all role and ownership checks server-side.

No complete P0 claims, measured latency claims, genuine bookings or deployed production-ready claims without the corresponding evidence. Keep verification/status docs current. Hosted sources are canonical in Sites repository; user ZIP is a portable snapshot.
