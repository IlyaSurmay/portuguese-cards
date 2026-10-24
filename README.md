# Portuguese Cards

Installable React + Vite flashcards for everyday Portuguese, with Ukrainian and Russian translations, recorded pronunciation, offline study, and scheduled reviews.

## Study

Reveal a card's translation, then rate your recall:

- **Remembered** schedules the next review in 1, 3, 7, 14, 30, then 60 days. Later successful reviews stay at 60 days.
- **Again** resets the review level and brings the card back in 10 minutes.
- Previously studied cards that are due appear before new phrases. Future reviews wait until their due time.
- **Browse all** lets you look through the deck without changing its schedule.

The summary shows cards due now, cards studied, cards at level 5 or above, and answers in the current session. Review times refresh every 30 seconds and when returning to the app. Language selection and progress are shared across Ukrainian and Russian.

Each card has a permanent `id`. Never regenerate these IDs when correcting text or reordering the deck. Existing five-tap progress is migrated to the corresponding review level; those cards are initially due because the old format did not record review dates. The legacy save is retained for recovery.

## Install and use offline

Open **https://portuguese-cards.vercel.app/** with an internet connection and wait for the "cards available offline" message.

- **iPhone / iPad:** Safari → Share → Add to Home Screen.
- **Android:** use the install button when offered, or the browser menu → Install app / Add to Home screen.

After the first successful load, the app shell, all phrases, and both translations are cached. Recordings cache automatically as they are played. In **Offline, backups and installation**, download all remaining recordings for offline audio. Downloads can be stopped and resumed, and retries skip completed files. Failed downloads are reported. The service worker supports byte-range playback for Safari.

A new build displays an update prompt rather than interrupting a study session. Applying it replaces the offline shell while retaining progress and downloaded audio.

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
- `src/flashcards.js`: scheduling, migration, storage and backup validation.
- `src/offline.js`: resumable audio downloads.
- `src/service-worker.js`: offline shell, audio caching and range responses.
- `src/translations.js`: Ukrainian/Russian interface text.

Regression tests cover migration, review scheduling, backup safety, storage failures, merging across tabs, offline launch, audio ranges, and resumable downloads. Real-device Add to Home Screen behavior should also be checked on Safari/iOS and Chrome/Android when changing installation settings.
