# CampusBite Sprint 3 — Journey Notes

- The existing `App.jsx` already contained uncommitted Student/Kitchen state placeholders; these were preserved and completed instead of resetting the file.
- The source displayed mojibake in the Windows terminal, so edits avoided rewriting existing student-facing copy and icons.
- Desktop-path patching was restricted by the local sandbox. Work was prepared in a workspace copy, verified, then only the changed app files and this record were synced back.
- Kitchen orders use browser local storage for sprint-level persistence. A future backend should replace this for multi-device, real-time kitchen use.
