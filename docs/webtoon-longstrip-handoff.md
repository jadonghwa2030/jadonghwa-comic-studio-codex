# Webtoon Longstrip Handoff

## Goal

- Webtoon output should behave like a continuous episode-style vertical scroll reader.
- `learning_comic`, `manga`, and `kling_i2v` keep their current page/frame-oriented rendering flow.
- Phase 1 covers generation, composition, and viewer replacement only.

## Phase 1 Scope

- Keep page-by-page image generation intact.
- Add an episode-level webtoon composition step that stitches generated webtoon pages into continuous vertical segments.
- Replace the webtoon completed view from card previews to a single continuous reader.
- Preserve existing ZIP download behavior as page-based output for now.

## Explicit Non-Goals

- No app-side font rendering or bubble overlay engine.
- No SFX-specific typography engine.
- No platform-specific export slicing for Naver/Kakao/CANVAS in this phase.
- No single ultra-tall monolithic image output.

## Data Contracts

### Page Layout Metadata

Add webtoon-only scroll metadata to `PageSpec.layout`:

```ts
scroll?: {
  segment_role: "intro" | "beat" | "climax" | "outro";
  gap_after_px: number;
}
```

Rules:

- Only populate this for `publication_format === "webtoon"`.
- `segment_role` is deterministic metadata for downstream reader/export logic.
- `gap_after_px` is defined at the planner stage using an 800px-wide baseline.

### Episode Render Result

Add a new episode-level result shape:

```ts
type WebtoonEpisodeRenderResult = {
  segment_urls: string[];
  source_page_indices: number[][];
  total_height_estimate: number;
}
```

Rules:

- `segment_urls[i]` corresponds to `source_page_indices[i]`.
- This result is derived from generated page images and is not persisted directly.
- It exists only to drive the webtoon reader UI and future export work.

### Persistence

- Persist plan/setup state only, not generated page images or episode segments.
- On project load:
  - restore the plan and edit state
  - keep generation results empty
  - rebuild the reader only after pages are generated again in the current session

## Planner Rules

- Webtoon should default to `embed_in_image`.
- `blank_bubbles_then_overlay` is not the default for webtoon anymore.
- Gap profile to baseline gap mapping is fixed:
  - `tight`: 24
  - `balanced`: 48
  - `breathing`: 96
  - `dramatic`: 160
- Last page always gets `gap_after_px = 0`.
- `segment_role` defaulting:
  - first page: `intro`
  - middle pages: `beat`
  - last page: `climax`

## Episode Composition Rules

- Build the episode result from generated page images in page order.
- Scale page-level `gap_after_px` from the 800px planning baseline to the actual render width.
- Insert white space between pages using that scaled gap.
- Output segments rather than one giant canvas.

Segment height caps:

- `1K`: 4096px
- `2K`: 8192px
- `4K`: 12288px

Behavior:

- When adding the next page would exceed the active cap, start a new segment.
- Keep page order stable.
- Keep the white gap between pages even across segment boundaries.

## UI Contract

- Webtoon mode must not use the existing 9:16 result card preview.
- Webtoon completed view has three zones:
  - top toolbar/status
  - page control list
  - continuous reader
- Per-page actions stay outside the reader:
  - edit
  - download page image
  - redraw / generate next
- Reader uses natural-height images with `w-full h-auto`.
- No `object-contain` 9:16 framing for webtoon output.

## Save / Restore Rules

- Do not persist generated page images.
- Do not persist `WebtoonEpisodeRenderResult`.
- Reopened projects restore plan/configuration only; the reader starts empty until new pages are generated.

## Verification Checklist

- Webtoon only:
  - continuous reader replaces page cards
  - generated pages stitch in order
  - gaps are visible and stable
- reopened saved projects do not restore old generated images
- Non-webtoon:
  - existing card/grid/frame UI still behaves as before
- Resolution changes:
  - episode reader rebuilds from current-session page results
  - redraw badges remain visible when image size changes
