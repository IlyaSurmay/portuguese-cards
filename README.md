# Portuguese Cards

A React + Vite flashcard app for learning everyday Portuguese phrases, with Ukrainian and Russian translations and recorded pronunciation.

- Choose **Українська** or **Русский** using the language selector. The interface and translations follow your choice, which is remembered in this browser.
- Click a card (or use Enter/Space when focused) to flip it.
- Use the audio button below the card to play or stop its Portuguese recording. Playback stops when changing cards or opening progress.
- Mark a card as learned five times to complete it. Both translation languages share the same learning progress.
- Open the progress screen to browse all 200 cards and sort by progress.

Progress is stored in the browser's `localStorage`; it does not sync between devices. Updates refresh bundled translations and audio links while preserving saved progress. Audio recordings are hosted externally and require an internet connection.

## Development

```sh
npm ci
npm run dev
```

```sh
npm test
npm run lint
npm run build
```

Card content lives in `src/tatabogatacards.json`: each entry has `portuguese`, `ukrainian`, `russian`, and `audioSrc` fields. Interface translations live in `src/translations.js`.
