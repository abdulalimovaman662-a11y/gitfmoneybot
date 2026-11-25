# GiftsDrop Platform — Technical Specification

Status: Approved product scope; implementation begins with Core.
Branch: feature/giftsdrop-platform-foundation
Repository: abdulalimovaman662-a11y/gitfmoneybot

## 0. Existing system and compatibility constraints

- Telegram bot: Python + aiogram 3, entry point `main.py`.
- Mini App/API: Node.js HTTP server in `web/server.js`; static UI in `web/index.html`.
- Persistent shared application data: PostgreSQL via `DATABASE_URL`.
- Railway runs two services from this repository: bot (`python main.py`) and Mini App (`/web`, `npm start`).
- Existing profile fields include `users.xp`, `last_xp_date`, `rank_bonus_openings`, and `selected_wings`; existing profile, inventory, referrals, roulette, rocket, and NFT battle routes must remain compatible.
- Economy invariants: first launch retains 3 free spins; 1 Telegram Star = 1 silver; one roulette spin costs 20 silver. No new feature may silently change balances, prices, existing inventory, referrals, or prize odds.
- Existing rank milestones and wing cosmetics remain: 50 copper, 500 metal, 1000 gold, 2000 silver, 3000 green diamond, 4000 blue diamond, 5000 red diamond.
- XP and competitive scores are progression only. No paid entry, cash-out, or wagering is introduced by this roadmap.
- All rewards and game outcomes must be server-authoritative. Never trust client-supplied XP, task completion, scores, winners, prices, or inventory ownership.

## 1. Product goals and non-goals

Primary goal: improve D1/D7/D30 retention by giving players clear, fair, repeatable reasons to return.

Product pillars:
1. Core: identity, progression, daily/weekly goals, achievements.
2. Arena: asynchronous and real-time competition, clans, tournaments, seasonal rankings.
3. Universe: game directory, collections, seasons, battle pass, event framework.

Non-goals for the initial release:
- No real-money prize pools, player-to-player cash transfers, or wager-based tournaments.
- No artificial online counts, fake win feeds, or fabricated activity.
- No forced streak loss mechanics; missed days should not erase earned progress.
- No migration that drops or rewrites existing user balances, inventory, claims, or battle history.

## 2. Architecture and shared contracts

Keep the current two-service topology initially:
- Mini App server owns PostgreSQL transactions and all game/progression APIs.
- Bot continues to call authenticated internal APIs; it must not independently award XP or edit shared progression rows.
- Browser Mini App authenticates through validated Telegram WebApp init data. Internal bot routes continue using the existing bot-token authentication.
- Use UTC for all daily/weekly boundaries and store timestamps as timestamptz.
- Every reward-producing command accepts or generates an idempotency key. A unique database constraint is the final duplicate-award guard.
- Mutating multi-row actions run in a PostgreSQL transaction; use row locks where balances, match state, or reward claims are involved.
- Add indexes for user/time, season/status, and leaderboard sort paths.
- API responses are versioned by stable field names; old response fields remain available.

## 3. Core data model

Reuse `users.xp` as the lifetime XP total and existing profile/rank fields. Add ledger-backed progression rather than a second competing XP counter.

### New tables

- `xp_ledger(id, telegram_id, amount, source_type, source_id, idempotency_key UNIQUE, metadata JSONB, created_at)`
  - Positive awards only in the first release; corrections use explicit admin/audit entries.
  - Unique idempotency key prevents duplicate rewards.
- `mission_definitions(id, code UNIQUE, title, description, cadence, action_type, target_count, xp_reward, silver_reward DEFAULT 0, starts_at, ends_at, active, config JSONB)`
  - Cadence is daily or weekly. Silver rewards default to zero and require explicit economy approval.
- `user_missions(id, telegram_id, mission_id, period_start, progress, completed_at, claimed_at, UNIQUE(telegram_id, mission_id, period_start))`
  - Completion and claim are distinct states; claim is idempotent.
- `achievement_definitions(id, code UNIQUE, title, description, category, target_count, xp_reward, cosmetic_reward JSONB, active)`
- `user_achievements(telegram_id, achievement_id, progress, unlocked_at, claimed_at, UNIQUE(telegram_id, achievement_id))`
- `user_titles(telegram_id, title_code, unlocked_at, selected_at)`
- `activity_events(id, telegram_id, event_type, source_id, payload JSONB, created_at)`
  - Append-only, server-generated events used to advance mission/achievement counters.
- `seasons(id, code UNIQUE, title, starts_at, ends_at, status, config JSONB)`
- `season_members( season_id, telegram_id, season_xp DEFAULT 0, pass_level DEFAULT 0, UNIQUE(season_id, telegram_id))`
- `pass_rewards(id, season_id, level, track, reward_type, reward_payload JSONB, UNIQUE(season_id, level, track))`
- `pass_claims(id, season_id, telegram_id, reward_id, claimed_at, UNIQUE(season_id, telegram_id, reward_id))`

### Core invariants

- `users.xp` is lifetime XP; `season_members.season_xp` is seasonal XP. They must never be conflated.
- Rank openings remain a separate rank metric; XP level does not silently replace opening-based wings/ranks.
- All reward claims require ownership checks and a unique claim record.
- Inventory rewards must create an inventory row in the same transaction as the claim.
- Daily period key is the UTC date; weekly period key is the UTC Monday date.
- Definitions are data-driven and can be deactivated without deleting player history.

## 4. Core API

Authenticated Mini App routes:
- `GET /api/me/progression`: lifetime XP, level, next-level progress, current rank, recent ledger entries.
- `GET /api/missions`: current daily/weekly definitions and this user's progress.
- `POST /api/missions/:id/claim`: atomically claim a completed mission.
- `GET /api/achievements`: definitions, progress, unlocked/claimed state.
- `POST /api/achievements/:id/claim`: claim XP/cosmetic reward idempotently.
- `GET /api/me/activity`: recent activity and progression history.

Internal service functions:
- `awardXp({telegramId, amount, sourceType, sourceId, idempotencyKey})`
- `recordActivity({telegramId, eventType, sourceId, payload})`
- `advanceMissionsAndAchievements(event)`

The internal functions, not the browser, determine eligible XP and progress. Existing successful game handlers emit events after their authoritative transaction succeeds.

## 5. XP and progression rules

Initial values are configurable server-side:
- First verified registration: 50 XP, exactly once.
- Daily visit: 20 XP at most once per UTC date; existing `last_xp_date` behavior must be migrated/retained without double-paying.
- Valid completed duel: 10 XP for participation, once per match.
- Completed NFT battle: 20 XP per eligible participant, once per battle.
- Mission completion: reward defined by mission definition.
- Seasonal events: reward defined by the event configuration.

Anti-farming:
- No XP for refreshing pages, opening profile repeatedly, or client-only animations.
- Daily/weekly task counters advance only from verified server events.
- Define per-source caps and cooldowns.
- Repeated self-match, cancelled match, duplicate callback, replayed request, or admin test event awards no player XP.
- XP award, ledger insert, and user XP update are one transaction.

Level formula: retain the existing `getLevelStats` contract initially; document and test boundary values before changing it. The UI must show lifetime XP, current level, progress to next level, and XP remaining.

## 6. Daily and weekly missions

- Initial UI: 3 daily missions and 5 weekly missions.
- Mission pool is configurable and selected deterministically per user/period to prevent reroll abuse.
- Daily resets at 00:00 UTC; weekly resets Monday 00:00 UTC.
- A mission can be progressed by multiple verified event types.
- Claim button appears only after target reached; claim endpoint is idempotent.
- Missed missions expire without removing lifetime XP, achievements, inventory, or previously earned rewards.
- Mission text clearly states the required action and exact reward.
- Admin tooling can activate/deactivate definitions, not edit a user's claimed state.

Suggested launch missions: complete a spin, view a profile, complete a valid battle, invite a new eligible user, visit on a later UTC day. Do not create tasks that encourage purchases or wagering.

## 7. Achievements and cosmetics

Launch categories:
- Getting started: first visit, first spin, first completed mission.
- Collection: first NFT, 5 unique items, 10 unique items.
- Competition: first completed battle, 10 completed battles.
- Community: first valid referral, join a clan (Arena phase).
- Consistency: 3 distinct visit days, 7 distinct visit days.

Achievement progress is permanent and monotonic unless a definition explicitly specifies otherwise. Cosmetic rewards include profile badges, frames, titles, and visual effects. Cosmetic unlocks must not alter probabilities or economy.

## 8. Arena scope

### Leaderboards
- Global lifetime XP leaderboard.
- Seasonal XP leaderboard.
- Optional category leaderboards (completed games, battles) only when metrics are auditable.
- Stable pagination and deterministic tie-breaking (score DESC, then earliest achieved timestamp ASC).
- Exclude banned/test accounts and clearly label season windows.

### Duels
- Invite by Telegram user ID or shareable invite link.
- Server creates a pending match with expiry; opponent must accept.
- Match state machine: pending -> accepted -> active -> completed; terminal alternatives: cancelled/expired/forfeit.
- Server stores the seed/round result or server-calculated score. Client cannot submit winner.
- Prevent self-play, multiple concurrent duplicate joins, replay, and awarding XP twice.
- First release is non-monetary, skill/score based, with no entry fee.

### Clans
- Create/join/leave with membership limits and one-clan-per-user policy.
- Roles: owner, moderator, member.
- Owner transfer and deletion are audited.
- Clan tasks aggregate verified activity, not raw client requests.
- Clan leaderboard based on a published, bounded scoring formula.

### Tournaments
- Admin-created schedule, registration window, capacity, rules, bracket/round format.
- Non-monetary rewards only for the first release.
- Match results are server-authoritative and auditable.
- Tournament state: draft -> registration -> in_progress -> completed/cancelled.
- Show timezone explicitly in UI.

## 9. Universe scope

- Central Games directory with categories, status (available/coming soon/seasonal), rules, and entry point.
- Collections page with owned items, set completion, rarity metadata, and seasonal archive.
- Season entity is the single source of truth for start/end times and featured content.
- Battle Pass: 30 levels, free track at launch, reward previews, mission-driven season XP, one-time claim records.
- Premium track remains disabled until payment, eligibility, refund/support, and compliance requirements are explicitly approved.
- Seasonal event framework supports scheduled start/end, event missions, event leaderboard, and cosmetic rewards.
- Snow Battle remains a seasonal mode with the previously planned Dec 1–Jan 31 availability window only if that schedule is still active in product configuration; do not hard-code client dates.

## 10. Mini App UX

Core navigation adds:
- Profile
- Missions
- Achievements
- Leaderboard

Arena adds:
- Arena home
- Duels
- Clans
- Tournaments

Universe adds:
- Games
- Collections
- Season / Battle Pass

UX requirements:
- Keep current visual language and mobile-first layout.
- Keep existing six-tab navigation functional; extend without making labels unreadable on small screens. Prefer a Games hub with subpages rather than cramming every feature into bottom navigation.
- Loading, empty, error, and success states for every new page.
- Optimistic UI may show pending progress but must reconcile with server response.
- Respect Telegram safe areas, reduced motion, and touch target sizes.
- No fake online counts or fake recent wins.

## 11. Security, privacy, and reliability

- Validate Telegram WebApp initData server-side and derive user identity from verified data.
- Rate-limit claim, invite, match creation/join, and search endpoints.
- Use parameterized SQL only.
- Never expose bot token, DB URL, admin IDs, or internal route credentials to the browser.
- Audit admin changes and reward adjustments.
- Add unique constraints for claims, event IDs, match participation, and idempotency.
- Add request size limits and strict input validation.
- Keep account deletion/data export policy consistent with published terms.
- Do not collect unnecessary profile data.

## 12. Analytics and retention measurement

Track real events: app_open, daily_reward_eligible, mission_progress, mission_claimed, achievement_unlocked, duel_created/accepted/completed, clan_joined, season_joined, pass_reward_claimed.

Dashboard metrics:
- DAU, WAU, MAU.
- D1, D7, D30 retention by registration cohort.
- Mission start/completion/claim rate.
- Average sessions per active user.
- Duel acceptance/completion rate.
- Season participation and pass completion.
No fabricated online or engagement counts.

## 13. Rollout plan and acceptance criteria

### Phase 0 — safety and baseline
- Create a feature branch.
- Record current database schema and endpoint contracts.
- Add automated smoke checks for existing start, profile, balance, spin, inventory, referrals, and NFT battles.
- Keep changes additive and reversible.

### Phase 1 — Core MVP
- Add XP ledger and idempotent award service.
- Preserve existing XP and daily XP without double awards.
- Add mission definitions/progress/claims and achievement definitions/progress/claims.
- Add Core UI pages and profile summary.
- Seed 3 daily + 5 weekly missions and launch achievements.
- Verify all awards are server-generated and duplicate requests cannot double-claim.

Acceptance:
1. Existing balances, free spins, prices, ranks, inventory, referrals, and payments are unchanged.
2. New account gets the configured one-time welcome XP; existing accounts are not retroactively re-awarded.
3. Daily XP and mission claims cannot be repeated within a period.
4. Client cannot forge XP, mission progress, or achievement completion.
5. All Core pages work on iOS Telegram Mini App and desktop.
6. Existing endpoints and bot commands pass smoke tests.

### Phase 2 — Arena MVP
- Add global/seasonal leaderboard.
- Add invite/accept/complete duel flow.
- Add clan membership and clan leaderboard.
- Add admin-managed non-monetary tournaments.
- Add anti-abuse tests and moderation controls.

### Phase 3 — Universe MVP
- Add Games directory, Collections, Seasons, and 30-level free Battle Pass.
- Add reward preview and idempotent claim.
- Add seasonal archive and event scheduling.
- Keep paid pass disabled until separately approved.

### Deployment
- Develop on branch; deploy to staging if available.
- Run schema migration and regression tests before production.
- Deploy Mini App and bot services in a coordinated order only when backward-compatible APIs are ready.
- Verify both Railway services reach SUCCESS and run post-deploy smoke checks.
- Never overwrite production data or remove existing services/volumes as part of this work.

## 14. First implementation ticket

Implement Core foundation first:
1. Add additive PostgreSQL migrations for `xp_ledger`, mission definitions/progress, achievement definitions/progress, and activity events.
2. Implement one transactional `awardXp` function with idempotency.
3. Implement verified activity event recording and mission/achievement progress.
4. Add read/claim API routes.
5. Add Core UI sections after the API is tested.
6. Add tests for UTC rollover, duplicate claims, duplicate events, concurrent claims, and preservation of existing economy/profile fields.
