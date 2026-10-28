# Inverse study mode

## Plan

- Add a compact, accessible Portuguese first / Translation first control above the cards. Keep language selection in Settings. Portuguese first remains the initial mode; remember subsequent choices.
- In Translation first, use the selected English, Ukrainian or Russian translation as the prompt and Portuguese as the answer. Tap the card to reveal it. Only then enable Portuguese audio and phrase explanations. Grading is available on either side; browsing and arrows never grade. The separate reveal button was removed because tapping the card already provides this action.
- Track review schedules, levels, counts and session answers separately for the two directions. Translation languages share each direction's progress. Preserve existing progress as Portuguese-first progress; start inverse progress empty. Stats and due queues describe the selected direction.
- Keep daily mixing, native page scrolling and the existing review intervals. Switching modes or languages returns the card to its prompt and stops audio. Undo remembers the graded direction, restores only that record, and returns to that direction and card.
- Store and export both progress maps and the selected mode. Use snapshot version 3 in the existing storage slot, accepting and migrating version 2 saves/backups. This makes older app tabs reject the new snapshot rather than overwrite inverse progress. Import and cross-tab merging compare each card's change timestamp independently in each direction. Old backups never erase inverse progress.
- Verify migration, independent schedules, Undo, invalid backups, failed writes, cross-tab merges, all languages, mobile layout, answer concealment, audio controls, reload and offline use. Run lint, tests and a production build; push and deploy through the existing Git integration, then verify production.

## Acceptance criteria

1. A saved Portuguese-first review is unchanged after enabling inverse mode. The same card starts unstudied in inverse mode.
2. The inverse prompt contains only the selected translation; tapping/revealing shows Portuguese and enables audio and explanations. Keyboard and screen-reader descriptions follow the visible side.
3. Grading and Undo affect only their original direction, including when Undo is pressed after changing modes.
4. Reload and offline launch restore the selected mode and both schedules. Export/import round-trips both modes; a version 2 import preserves existing inverse records.
5. Both modes scroll natively on small touch screens; no swipe handlers are introduced.

## Implemented verification

- `npm run lint`, `npm run build`, `git diff --check`: passed.
- `node --test --test-isolation=none tests/*.test.mjs`: 65 tests passed, including 10 inverse-mode tests covering migration, independent scheduling, persistence, merge safety, Undo, invalid backups and storage failures.
- Chromium at 390 × 844 and 320 × 568: passed migration from a seeded version 2 save, independent grading and statistics, inverse reveal and accessible descriptions, recorded audio playback after reveal, audio stopping when the answer is hidden, explanation gating, all three translation languages, cross-mode Undo, browsing, export/import, two-tab merging, native diagonal touch scrolling, and offline reload/reveal/explanations/grading/Undo. No page errors or pointer captures.
