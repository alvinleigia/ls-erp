# P13S shared image preparation before upload

The shared `components/uploads/ImageFileInput` adds optional local preparation to
KYC file selection. Choose a JPEG/PNG, click Crop image, adjust the selection and
optionally rotate in 90-degree steps. Reset restores the starting selection and
orientation. Apply crop selects the prepared file; Cancel keeps the previous
selection, and Use original selects the unchanged original File. Reopening uses
the local original so repeated edits do not repeatedly recompress a JPEG.

Nothing is reserved or uploaded by the editor. Only the separate Upload evidence
action starts the existing signed upload/finalization flow. The confirmed file is
the accepted evidence; the source photo is not separately stored. Accepted evidence
cannot be edited through this component. PDFs and files uploaded without editing
keep their existing exact-byte path. A full-frame, unrotated Apply crop also returns
the original File without encoding.

## Shared interface

`components/uploads/image-file-input.tsx` is a controlled local file picker:

```tsx
<ImageFileInput
  id="business-image"
  value={file}
  onChange={setFile}
  accept="image/jpeg,image/png"
  maxBytes={uploadLimit}
  disabled={busy}
  // aspect={1} // Optional fixed ratio; omit for document cropping.
/>
```

The owning module supplies its file label, limits, allowed file picker types,
permissions and upload/storage action. Only JPEG/PNG receive crop controls. The
component accepts browser File objects, not remote private-file URLs. KYC is the
first integration; branding, avatars and catalog upload screens are not changed.

Empty and over-limit selections are rejected immediately beside the file picker,
with the selected size and the allowed maximum. The invalid File is not passed to
the consumer, so Crop and Upload cannot act on it or an earlier valid selection.
Choosing a valid replacement clears the error. The evidence limit remains 5 MB
for both source selection and final upload; larger originals are not decoded just
to reduce them through cropping.

Valid local images show a thumbnail before upload; Apply crop replaces it with
only the selected crop. Header/pixel bounds are checked before decoding, preview
URLs are tied to their current File and revoked when replaced/unmounted. Nothing
is persisted in browser storage and no remote evidence download is added.

`components/uploads/upload-file.ts` provides a browser PUT transfer using actual
upload progress events. Consumers own signed reservations, headers, finalization
and success handling. KYC displays transfer percentage, then its existing separate
server-validation state. Failed transfers clear the bar, preserve the local File
and existing pending-upload recovery; they never report accepted evidence. The
confirmed File is sent directly, preserving exact bytes without an extra explicit
array-buffer copy. No upload endpoint, storage copy or server image processing is
added.

Selection/thumbnail/progress validation on 2026-11-17: production build,
TypeScript, targeted ESLint and whitespace checks passed. The focused crop runner
passed 67 native checks and all ten local browser flows; both hosted staging
acceptance tests passed at source `1df9098`. Desktop/mobile selection-error and
progress captures were inspected. Coverage includes invalid replacement clearing
the prior selection, inclusive size boundary, crop thumbnail dimensions, transfer
versus validation phases, storage failures/cancellation/retry, byte preservation,
PDF/JPEG/PNG handling and existing review/removal protections. Production has not
received this UI increment yet. See MODULAR_PLATFORM.md for deployment evidence.

The crop dialog is dynamically loaded, using the ISC-licensed open-source
[`react-image-crop`](https://github.com/dominictobias/react-image-crop) 11.1.2 from the pinned dependency lock. No CDN, external image
service, server image optimizer or new upload endpoint is used. Keyboard and touch
selection come from the library; quarter-turn drawing and file export are shared
browser Canvas helpers.

## Bounds, quality and privacy

- Source bytes are bounded by the consumer's upload limit. PNG/JPEG dimensions are
  inspected before decoding; preparation accepts at most 20 megapixels and 16,384
  pixels per side. Existing server validation remains authoritative.
- Phone JPEG EXIF orientation is applied when decoding. The working preview is
  capped at 1,600 pixels per side. Export draws directly from the original decoded
  bitmap at natural pixel resolution, independent of viewport/preview size.
- PNG export retains transparency. JPEG export uses quality 0.95. There is no
  automatic downscaling to fit a byte limit. Empty/over-limit output is rejected
  without replacing the selected file; the user can crop again or use the original.
- Prepared names retain a recognizable base and `-cropped` suffix, with path/control
  characters excluded and a 120-character maximum. Server filename validation is
  unchanged. New encoding does not copy the source JPEG EXIF metadata.
- Local preview object URLs are revoked on replacement/unmount, decoded bitmaps
  are closed when the dialog ends, and the export canvas is released after encoding.
  Source changes clear the KYC selection. There are no file contents, names or crop
  coordinates added to logs, persistent browser storage or ordinary audit.

No database schema, tenant setting, module flag, permission, accepted file or stored
document is changed by image preparation itself. Duplicate removal has a separate
migration and release status; see `P13S_IMAGE_STAGING_ACCEPTANCE.md`.

## Verification

Run `node --require ./tests/register.cjs --test tests/image-preparation.test.cjs`
for header/limit/geometry checks. After a production build,
`node scripts/test-sales-orders.cjs --verification-crop --browser` runs the guarded
disposable database suite and real browser upload/review/disposal regressions.
No hosted customer records or service credentials are used.

Browser coverage includes responsive cropping, exact stored checksum/dimensions,
PNG alpha and rotation, unchanged originals, phone JPEG orientation, output-limit
failure, corrupt local images, unchanged PDFs, uploads above 4.5 MB, private evidence
permissions, duplicate removal and independent review. Desktop/mobile captures are
saved under `test-results/local-access/image-crop-{desktop,mobile}.png`.
Final validation and release status are recorded in MODULAR_PLATFORM.md.

Local acceptance, 2026-11-17: all 54 focused checks passed (eight image preparation
checks included). All eight final browser flows passed after a completed production
build. The large-image test proves that a 1,600-pixel preview exports the natural
crop dimensions rather than reducing the stored image to preview size. JPEG
orientation, PNG alpha and exact final storage checksums were verified. Targeted
ESLint and whitespace checks passed, and both responsive screenshots were inspected.
Evidence: `tmp/p13s-crop-final-tests.log`, `tmp/p13s-crop-final-browser.log`,
`tmp/p13s-crop-build.log`, `tmp/p13s-crop-lint.log`, and
`tmp/industry-release/ls-erp-sales-orders-69dd83e53e93.log`.
That local run did not use hosted uploads or deploy. Subsequent hosted staging
acceptance passed; see `P13S_IMAGE_STAGING_ACCEPTANCE.md`. Production is unchanged.
