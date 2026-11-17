# P13S upload selection, thumbnails and progress: production release

Completed on 2026-11-17 without maintenance interruption.

GitHub main and staging were fast-forwarded atomically to
`721dfa6bfe5073ccda8dc004e5b02b212254c534`. Production deployment
`dpl_6dW9a4R9rQjMgGNxUS2tAjcF6Wze` and staging deployment
`dpl_8UyfmUVkoyGf1vwqMVcBwZf9X2rs` are READY at that source. All three production
aliases and the staging alias were verified against their registered projects.

This releases immediate empty/size validation, bounded local thumbnails before
and after cropping, and actual browser upload progress followed by separate
server validation. The 5 MB evidence limit remains unchanged. There are no new
dependencies, migrations, storage copies, permission changes or server image
processing. Both databases still have 159 applied migrations and none pending.

Application and test source exactly match hosted staging acceptance `1df9098`.
The subsequent commit only records acceptance. Existing validation passed 67 native
checks, ten local browser flows and both hosted acceptance tests, covering byte
integrity, crop previews, progress and validation phases, failed upload recovery,
PDF/JPEG/PNG behavior and existing removal/review protections.

The existing Ewissen admin session passed five authenticated production views and
the queue API. A synthetic image was selected locally, displayed as a thumbnail,
rotated/cropped and shown with the new dimensions. An unsaved 12 MB selection
immediately displayed its size error, removed the preview/crop control and disabled
upload. Desktop/mobile captures were inspected; mobile had no horizontal overflow.
The local selection was cleared afterwards. No upload or business change was
submitted. Real transfer progress was tested on staging, rather than by creating
production evidence.

Profiles, module settings, verification policy, checkpoints and retention match
the pre-release API snapshot. No production customer file was changed or deleted.
No database or storage maintenance operation was needed. The previous immutable
deployment remains a code rollback target without any schema rollback.

Private release receipts are under `tmp/p13s-file-validation/production/`; live
captures are under `test-results/p13s-upload-ui-production/`. Shared implementation
details are in `P13S_IMAGE_PREPARATION.md`. This is a local release-record follow-up
and does not trigger redundant deployment builds.
