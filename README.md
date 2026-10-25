# Portuguese Cards

Installable React + Vite flashcards for everyday Portuguese, with Ukrainian, Russian and English translations, recorded pronunciation, offline study, and scheduled reviews.

English is the default for new sessions. Existing saved language choices are kept.

## Study

Reveal a card's translation, then rate your recall:

- **Remembered** schedules the next review in 1, 3, 7, 14, 30, then 60 days. Later successful reviews stay at 60 days.
- **Again** resets the review level and brings the card back in 10 minutes.
- Previously studied cards that are due appear before new phrases. Future reviews wait until their due time.
- **Browse all** lets you look through the deck without changing its schedule.

The summary shows cards due now, cards studied, cards at level 5 or above, and answers in the current session. Review times refresh every 30 seconds and when returning to the app. Choose the translation language in Settings; all three languages share the same card progress and review schedule.

Use **ⓘ** beside the card counter to open a phrase breakdown: Portuguese building blocks with meanings in your selected language, a short grammar note, and a different example with its translation. All 200 cards have bundled explanations focused on European Portuguese. English notes are written for English speakers, covering omitted subjects, gender and articles, contractions, polite verb forms, false friends and idiomatic translations. Opening or closing an explanation does not flip, grade, or reschedule a card. No AI service, API key, or network request is needed to read them.

Each card has a permanent `id`. Never regenerate these IDs when correcting text or reordering the deck. Existing five-tap progress is migrated to the corresponding review level; those cards are initially due because the old format did not record review dates. The legacy save is retained for recovery.

## Install and use offline

Open **https://portuguese-cards.vercel.app/** with an internet connection and wait for the "cards available offline" message.

- **iPhone / iPad:** Safari → Share → Add to Home Screen.
- **Android:** use the install button when offered, or the browser menu → Install app / Add to Home screen.

After the first successful load, the app shell, all phrases, all three translations, and all explanations are cached. Recordings cache automatically as they are played. In **Settings**, download all remaining recordings for offline audio. Downloads can be stopped and resumed, and retries skip completed files. Failed downloads are reported. The service worker supports byte-range playback for Safari.

A new build displays an update prompt rather than interrupting a study session. Applying it replaces the offline shell while retaining progress and downloaded audio.

## Daily reminders

In **Settings**, select a time and tap **Enable reminders**, then allow notifications. On iPhone/iPad this requires iOS 16.4+ and opening the app from its Home Screen icon. Other supported browsers include current Chrome, Firefox and Edge. Permission is requested only after tapping Enable, never on page load.

The daily notification opens the cards. A separate **Test notification** button checks delivery; tests are limited to one per minute. Change the time with **Save time**, or use **Turn off reminders** on each device. Changes require internet. Language selection is also in Settings, below the study section.

The schedule uses the device's IANA time zone when saved and follows daylight saving changes. A missing spring-forward time shifts forward; an ambiguous fall-back time uses the first occurrence. Opening the app online refreshes the language and time zone, including after travel. Notification delivery can be delayed by connectivity or OS settings such as Focus. Device permission must remain enabled.

Learning progress stays local. The backend stores only the push subscription, reminder time, zone, language, a hash of the device's management credential, and delivery state in private Vercel Blob objects. The raw management credential stays in local storage under `portuguese-cards-reminder-v1` and is independent of progress backups. Disabling removes the stored push endpoint and encryption keys; a disabled record remains so old queued jobs cannot reactivate it. Revoked/expired subscriptions are automatically disabled when the push provider returns 404/410.

Vercel Queues runs delayed daily jobs, registered in `vercel.json`; no frequent Cron Job or separate scheduling service is needed. A consumer forwards each due job to the current production API, so tomorrow’s job uses the current deployment. A protected daily Vercel Cron Job repairs interrupted or expired schedules; its once-daily frequency is compatible with Hobby. Conditional storage writes, queue idempotency keys, daily delivery receipts and a stable notification tag reduce duplicates during retries. Push delivery is at least once, so a crash between provider acceptance and saving its receipt can still cause a replacement notification. Old reminders are skipped rather than delivered in a burst after an outage. Opening the app also repairs an interrupted schedule.

Production server configuration (already provisioned for this project):

- `WEB_PUSH_PUBLIC_KEY`: public VAPID application server key, returned by the configuration endpoint.
- `WEB_PUSH_PRIVATE_KEY`: matching VAPID private key, stored as a production Secret. Never use a `VITE_` prefix or commit it.
- `CRON_SECRET`: production Secret authorizing the once-daily recovery job and internal delivery forwarding.
- `BLOB_STORE_ID`: connected **private** store, using Vercel OIDC authentication. `BLOB_READ_WRITE_TOKEN` is an alternative for a token-connected store. Production storage credentials must not be shared with previews.

The private store and queue have free usage allowances on Vercel; normal limits and plan quotas still apply. For local full-stack development, link the project with Vercel CLI, configure separate development keys/storage, run `vercel env pull .env.local`, then `vercel dev`. Production Secrets are not pulled into local files. `npm run preview` alone serves the offline frontend without the reminder API.

## Progress and backups

Progress is local to this browser/installation and origin. Always use the canonical URL above. There is no automatic device sync. Browser storage can be cleared or evicted, and an installed iOS web app may use different storage from its browser tab.

Export a JSON backup before changing devices, installing the app, or clearing site data. Import validates the file and shows a preview before applying it. It merges each card's most recent review, preserving unrelated progress. Both older successful reviews and newer lapses are handled by review timestamp. Unsupported or malformed backups are rejected without changing progress.

Only versioned progress and language preference are saved in `portuguese-cards-progress-v2`; card content comes from the bundled deck. Save failures display a warning and keep study working in memory. Unreadable saves are left untouched until an explicit backup restore. Export remains available when browser storage fails.

## Development

```sh
npm ci
npm run dev
```

```sh
npm test
npm run lint
npm run build
npm run preview
```

Service workers are enabled in production builds; use `npm run preview` to test installation and offline behavior. The Vite build emits `sw.js` with a versioned precache list. `vercel.json` ensures browsers revalidate updates to the worker and manifest.

- `src/tatabogatacards.json`: stable IDs, phrases, translations and audio URLs.
- `src/phrase-explanations.json`: hand-authored chunks, grammar notes and examples in all three languages, keyed by the same stable card IDs. Keep its coverage in sync with the deck. Source spelling issues are explained in the notes; original phrases are retained for legacy progress migration.
- `src/flashcards.js`: scheduling, migration, storage and backup validation.
- `src/offline.js`: resumable audio downloads.
- `src/service-worker.js`: offline shell, audio caching and range responses.
- `src/useReminders.js` and `src/reminders.js`: opt-in notification controls and device settings.
- `server/reminder-core.mjs`: time-zone scheduling, ownership, retries and delivery receipts.
- `server/reminder-services.mjs`: private Blob, Web Push and Queues adapters.
- `api/reminders.js` and `api/send-reminder.js`: subscription API and queued daily delivery.
- `src/translations.js`: Ukrainian/Russian/English interface text.

Regression tests cover migration, review scheduling, backup safety, storage failures, merging across tabs, offline launch, audio ranges, resumable downloads, reminder scheduling across DST, notification display/clicks, ownership checks, retries and cancellation. Real-device Add to Home Screen behavior should also be checked on Safari/iOS and Chrome/Android when changing installation settings.
