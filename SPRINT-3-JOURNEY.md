# CampusBite Sprint 3 — Journey Notes

- The existing `App.jsx` already contained uncommitted Student/Kitchen state placeholders; these were preserved and completed instead of resetting the file.
- The source displayed mojibake in the Windows terminal, so edits avoided rewriting existing student-facing copy and icons.
- Desktop-path patching was restricted by the local sandbox. Work was prepared in a workspace copy, verified, then only the changed app files and this record were synced back.
- Kitchen orders use browser local storage for sprint-level persistence. A future backend should replace this for multi-device, real-time kitchen use.

## Sprint 3.5 — Kitchen batch-card layout

- **Issue:** Production Batch Summary buttons and text could extend beyond their cards or overlap adjacent cards, especially on laptop, tablet, and mobile widths.
- **Root cause:** The responsive grid rule targeted `.production-batch-grid`, while the rendered JSX uses `.prep-grid`. The action sizing rule similarly targeted `.batch-actions`, while the live component uses `.batch-progress-actions`. A pre-existing mobile rule also forced two columns into a narrow viewport.
- **Fix:** Applied the wrapping grid to the live `.prep-grid`, gave cards equal-height grid rows with zero-safe minimum widths, made the real action wrapper span the full card, enabled safe text wrapping, collapsed the grid to one column below 700px, and prevented page-level horizontal overflow.
- **Confirmed lifecycle repair:** The batch calculator had been changed to exclude READY orders, which removed a completed card before its `Completed` state could render. Completed linked orders remain in the derived batch summary so the final state and traceability stay visible.
- **Tests:** Ran ESLint and the Vite production build; checked desktop, laptop, tablet, and mobile layout widths; exercised Student order → Kitchen NEW → Start Batch → PREPARING → Complete Batch → READY → Completed.
- **Lesson:** CSS selectors must be verified against the rendered component names. Responsive rules for unused or renamed classes can look correct in isolation while providing no protection in the actual UI.
