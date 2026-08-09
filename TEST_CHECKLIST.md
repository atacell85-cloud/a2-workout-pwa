# Test Checklist

## Manual scenarios

- A: Start Upper, save a few sets, finish workout, verify session appears in History.
- B: Start Upper again, verify previous performance appears under the matching exercise.
- C: Edit a saved set, delete a set, reload, verify persisted data is correct.
- D: Reload during an active workout, verify the draft session can be resumed.
- E: Export JSON, restore it in a clean browser profile/storage state, verify sessions and sets return.
- F: Export CSV and verify each set row includes session, day, exerciseId, setType, kg, reps, RIR, timestamp.
- G: Confirm `manifest.webmanifest` and `sw.js` cache app shell assets including JS modules.
- H: Test around 375 px wide viewport for horizontal overflow, overlapping controls, and unusable buttons.

## iPhone checks

- Numeric keyboard opens for kg, tekrar and RIR.
- Safari does not zoom into inputs.
- Bottom nav respects home indicator safe area.
- Installed home-screen app opens standalone.
- After first online load, app shell opens offline.
