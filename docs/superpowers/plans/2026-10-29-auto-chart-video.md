# Auto Chart Video Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 入力音源または動画から自動譜面、背景動画、透明ゲーム動画、合成済みMP4をキャッシュ付きで生成するNode.js CLIを構築する。

**Architecture:** CLIは入力解決と4工程のオーケストレーションだけを担い、背景生成、譜面生成、Canvas描画・透明動画化、最終合成を独立モジュールへ分ける。各工程は決定論的な入力キーと成果物ハッシュをマニフェストへ原子的に記録し、変更された工程以降だけを再実行する。

**Tech Stack:** Node.js 20+ ESM、組み込み `node:test`、FFmpeg/FFprobe、Playwright Chromium、HTML Canvas 2D、ProRes 4444、H.264/AAC

---

## File map

```text
package.json                         npm scripts and Playwright dependency
run.command                         thin macOS launcher
src/cli.mjs                         argument parsing and top-level exit handling
src/build/build-song.mjs            four-stage orchestration only
src/build/config.mjs                config loading, precedence, validation
src/build/inputs.mjs                MP3/video mode input resolution
src/build/manifest.mjs              stage keys, artifact hashes, atomic updates
src/platform/process.mjs            safe child-process execution and streaming
src/media/probe.mjs                 FFprobe JSON parsing and normalized metadata
src/media/lrc.mjs                   LRC parsing and SRT serialization
src/media/background.mjs            existing spectrum/background FFmpeg behavior
src/chart/audio-analysis.mjs        PCM decode, FFT, onset and tempo analysis
src/chart/generate-chart.mjs        level design and lane assignment
src/chart/schema.mjs                chart validation and stable JSON writing
src/render/geometry.mjs             perspective lane/note coordinate math
src/render/canvas-renderer.mjs      deterministic Canvas drawing
src/render/renderer.html            transparent Playwright render surface
src/video/render-overlay.mjs        PNG stream to ProRes 4444
src/video/composite.mjs             alpha overlay to final H.264 MP4
test/*.test.mjs                     focused unit tests matching modules
test/fixtures/                      tiny generated fixtures only
test/integration/pipeline.test.mjs  short end-to-end and cache tests
```

All CLI/config path strings are resolved against `process.cwd()`. Media duration assertions allow an error of at most one 30fps frame plus 1ms.

## Chunk 1: Foundation, input contracts, and cache

### Task 1: Project skeleton and command runner

**Files:**
- Create: `package.json`
- Create: `src/platform/process.mjs`
- Create: `test/process.test.mjs`

- [ ] **Step 1: Add the failing process-runner tests**

Test `runProcess(command, args, options)` with `process.execPath`: it must capture stdout/stderr, preserve an argument containing spaces and `×`, and reject a nonzero exit with `{ command, code, stderr }` on the error. Test `spawnProcess()` returns `{ child, completed }`, exposes a writable `child.stdin`, resolves `completed` only after exit code 0, rejects spawn errors/nonzero exits, and does not swallow stdin `EPIPE`. Test `commandExists()` for the current Node executable.

- [ ] **Step 2: Run the tests and confirm the intended failure**

Run: `node --test test/process.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/platform/process.mjs`.

- [ ] **Step 3: Create package metadata and the minimal process runner**

Use this package contract:

```json
{
  "name": "music-game-video",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "test": "node --test",
    "build:example": "node src/cli.mjs build \"example/HERE × HEAR/HERE × HEAR.mp3\""
  },
  "dependencies": { "playwright": "^1.56.0" }
}
```

Implement child processes with `spawn(command, args, { shell: false })`. Never interpolate media paths into a shell string. `runProcess()` captures complete stdout/stderr. `spawnProcess(command, args, { stdin: 'pipe' })` returns the raw child plus a `completed` promise, accumulates bounded stderr for diagnostics, removes listeners after settlement, and terminates/rejects when stdin or the child errors. This is the only API used later for PNG streaming.

- [ ] **Step 4: Install and lock dependencies**

Run: `npm install`

Expected: exit code 0, `node_modules/playwright` exists, and a tracked `package-lock.json` is generated. Do not run the browser download yet; runtime preflight and the documented `npx playwright install chromium` step handle it.

- [ ] **Step 5: Verify and commit**

Run: `node --test test/process.test.mjs`

Expected: all process tests PASS.

Run: `git add package.json package-lock.json src/platform/process.mjs test/process.test.mjs`

Commit: `git commit -m "chore: initialize Node video pipeline"`.

### Task 2: Configuration and input resolution

**Files:**
- Create: `src/build/config.mjs`
- Create: `src/build/inputs.mjs`
- Create: `test/config.test.mjs`
- Create: `test/inputs.test.mjs`

- [ ] **Step 1: Write failing config tests**

Cover defaults, config JSON, CLI precedence, relative paths resolved from `process.cwd()`, all allowed keys and types, rejected unknown keys, rejected out-of-bounds layout, and the exact default layout:

```js
{
  difficulty: 'normal', seed: 12345, outDir: '<cwd>/output', cover: null,
  layout: { gameX: 0.5, gameY: 0.82, gameWidth: 0.58, gameHeight: 0.68 }
}
```

- [ ] **Step 2: Write failing input-resolution tests**

Use temporary directories. Cover case-insensitive `.mp3/.lrc/.png/.jpg/.jpeg`, missing companions, ambiguous cover images, explicit `--cover`, `.mp4/.mov`, unsupported extensions, and paths containing spaces/Unicode. Verify video mode ignores neighboring LRC/images.

- [ ] **Step 3: Run the tests to verify failure**

Run: `node --test test/config.test.mjs test/inputs.test.mjs`

Expected: both fail with missing modules.

- [ ] **Step 4: Implement strict config parsing and input contracts**

Export `loadConfig({ cwd, inputPath, cli })` and `resolveInputs({ inputPath, cover })`. Return plain immutable data. Validate that the trapezoid stays inside the frame:

```js
gameX - gameWidth / 2 >= 0
gameX + gameWidth / 2 <= 1
gameY - gameHeight >= 0
gameY <= 1
```

- [ ] **Step 5: Verify and commit**

Run: `node --test test/config.test.mjs test/inputs.test.mjs`

Expected: all tests PASS.

Run: `git add src/build/config.mjs src/build/inputs.mjs test/config.test.mjs test/inputs.test.mjs`

Commit: `git commit -m "feat: resolve build configuration and inputs"`.

### Task 3: Media probing and preflight

**Files:**
- Create: `src/media/probe.mjs`
- Create: `test/probe.test.mjs`

- [ ] **Step 1: Write failing FFprobe parser tests**

Provide inline FFprobe JSON fixtures for MP3, VFR MP4, rotated MOV, missing audio, and multiple tracks. Fix the `parseProbe()` return contract to:

```js
{
  durationSec: 5.0,
  video: { index: 0, codec: 'h264', encodedWidth: 1920, encodedHeight: 1080,
    displayWidth: 1080, displayHeight: 1920, rotationDeg: 90,
    avgFps: 29.97, isVfr: true, startSec: 0.0, durationSec: 5.0 },
  audio: { index: 1, codec: 'aac', sampleRate: 48000, channels: 2,
    startSec: 0.0, durationSec: 4.8 }
}
```

All times use seconds. Missing/non-finite per-stream durations fall back to format duration. Verify the first video/audio streams are selected by lowest FFprobe stream index and video input without audio is rejected.

Also test `preflight()` through injected command/check functions: Node 19 rejection, missing FFmpeg, missing FFprobe, missing `subtitles` in MP3 mode, `subtitles` not required for video mode, and missing Playwright Chromium with the exact installation instruction.

- [ ] **Step 2: Verify failure**

Run: `node --test test/probe.test.mjs`

Expected: FAIL with missing `src/media/probe.mjs`.

- [ ] **Step 3: Implement probe and preflight interfaces**

Export `probeMedia(path, { ffprobe })`, `parseProbe(json)`, and `preflight({ mode, ffmpeg, ffprobe, nodeVersion, checkChromium })`. Preflight runs once at CLI startup before any build stage, verifies Node >=20, executable versions, the `subtitles` filter only for MP3 background generation, and Playwright Chromium availability. Missing Chromium must report `npx playwright install chromium`.

- [ ] **Step 4: Verify and commit**

Run: `node --test test/probe.test.mjs`

Expected: PASS.

Run: `git add src/media/probe.mjs test/probe.test.mjs`

Commit: `git commit -m "feat: inspect media and runtime capabilities"`.

### Task 4: Stage cache manifest

**Files:**
- Create: `src/build/manifest.mjs`
- Create: `test/manifest.test.mjs`

- [ ] **Step 1: Write failing cache tests**

Cover stable object hashing independent of key order, SHA-256 file hashing, cache hit only when key/artifact/hash all match, dependency-graph invalidation, and atomic per-stage updates that preserve earlier successful stages. Explicitly verify `background -> final` and `chart -> overlay -> final`: an LRC/background change must not invalidate chart/overlay, while a chart change must not invalidate background. Broken JSON, unknown manifest format, missing artifacts, and video-background cache metadata without `analysisAudioHash` must safely become cache misses.

- [ ] **Step 2: Verify failure**

Run: `node --test test/manifest.test.mjs`

Expected: FAIL with missing module.

- [ ] **Step 3: Implement the manifest contract**

Use this shape and write through a sibling `.tmp` followed by `rename()`:

```json
{
  "formatVersion": 1,
  "resolvedConfig": {},
  "stages": {
    "background": { "key": "sha256", "artifactHash": "sha256",
      "metadata": { "analysisAudioHash": "sha256" }, "completedAt": "ISO" }
  }
}
```

Export `hashFile`, `hashValue`, `readManifest`, `isStageHit`, `recordStage`, and `invalidateDependents(stage)` using this graph. `recordStage` accepts an optional JSON-serializable `metadata` object and preserves it on cache hits:

```js
{
  background: ['final'],
  chart: ['overlay', 'final'],
  overlay: ['final'],
  final: []
}
```

Invalidation is transitive and never deletes a successful unrelated stage entry.

- [ ] **Step 4: Verify Chunk 1 and commit**

Run: `npm test`

Expected: all Chunk 1 tests PASS.

Run: `git add src/build/manifest.mjs test/manifest.test.mjs`

Commit: `git commit -m "feat: add resumable stage cache"`.

## Chunk 2: Existing background behavior and automatic chart generation

### Task 5: LRC conversion

**Files:**
- Create: `src/media/lrc.mjs`
- Create: `test/lrc.test.mjs`

- [ ] **Step 1: Write failing LRC tests**

Cover multiple timestamps on one line, centiseconds/milliseconds, metadata tags ignored, stable chronological sorting, blank lyric removal, repeated timestamps, CRLF, final lyric lasting four seconds, and a minimum 100ms cue length.

- [ ] **Step 2: Verify failure**

Run: `node --test test/lrc.test.mjs`

Expected: missing-module failure.

- [ ] **Step 3: Implement `parseLrc(text)` and `toSrt(items)`**

Match the behavior of `/Users/teradonburi/Desktop/spectrum_video.command`; keep parsing pure and UTF-8. Assign sequential SRT indexes only after sorting.

- [ ] **Step 4: Verify and commit**

Run: `node --test test/lrc.test.mjs`

Expected: PASS.

Run: `git add src/media/lrc.mjs test/lrc.test.mjs`

Commit: `git commit -m "feat: convert synchronized lyrics to subtitles"`.

### Task 6: Background video generator

**Files:**
- Create: `src/media/background.mjs`
- Create: `test/background.test.mjs`
- Create: `test/helpers/create-fixtures.mjs`

- [ ] **Step 1: Write failing FFmpeg-argument tests**

Test `buildMp3BackgroundArgs()` for the exact 1280×720 crop, seven `showfreqs` color bands, subtitle style, 30fps, H.264/AAC, source audio mapping, and shortest duration. Test `buildVideoBackgroundArgs()` for first video/audio mapping, PTS reset, autorotation, original display dimensions, 30fps CFR, audio trim/pad to video duration, H.264/AAC, and rotation metadata removal.

- [ ] **Step 2: Verify failure**

Run: `node --test test/background.test.mjs`

Expected: missing-module failure.

- [ ] **Step 3: Implement argument builders and the explicit background interface**

Implement:

```js
createBackground({
  inputs, // { mode:'mp3', audioPath, lrcPath, coverPath } | { mode:'video', videoPath }
  outputPath, logPath, ffmpegPath, ffprobePath, tempRoot,
  runProcessFn = runProcess, probeMediaFn = probeMedia
}) // => Promise<{ path:absolutePath, media:parseProbeResult }>
```

For MP3 mode, write SRT into a `mkdtemp()` directory with an ASCII-only name, execute the existing filter graph without shell interpolation, then remove the temporary directory in `finally`. For video mode, use FFprobe metadata to set the exact output size and duration. Write to `background.tmp.mp4`, probe it, then rename to `background.mp4` only if it is 30fps CFR, has H.264 video and AAC audio, begins at zero within one frame, and matches expected duration within one frame plus 1ms. Return only after successful rename. On FFmpeg failure, atomically write `logPath` with stage name, executable and JSON-encoded argument array, exit code, and complete captured stderr before rethrowing; test this with an injected failing `runProcessFn`.

- [ ] **Step 4: Add a five-second integration fixture generator**

Create `test/helpers/create-fixtures.mjs` that invokes FFmpeg lavfi sources at test runtime; do not commit generated binaries. Generate five-second 320×180 fixtures: MP3 with 440Hz sine, solid PNG, two-cue LRC, CFR MP4, a timestamp-preserving concat of 15fps and 30fps segments, rotation-tagged MOV, five-second video with three-second audio, five-second video with seven-second audio, no-audio video, and a file with two differently colored video tracks plus two distinct sine-frequency audio tracks. Probe the VFR fixture immediately and assert `parseProbe(...).video.isVfr === true`; fixture setup must fail if it accidentally becomes CFR.

- [ ] **Step 5: Add real `createBackground()` integration cases**

Extend `test/background.test.mjs` to invoke FFmpeg through the public interface for every generated fixture. Assert temp cleanup and atomic output, H.264/AAC, source display dimensions, 30fps CFR, PTS near zero, duration tolerance, rotation application, short-audio padding, long-audio trimming, and first-track selection using representative frame color and audio frequency. When FFmpeg lacks `subtitles`, skip only the MP3/LRC case with an explicit reason; all video-mode cases must still run.

- [ ] **Step 6: Verify and commit**

Run: `node --test test/background.test.mjs`

Expected: argument and short integration cases PASS; only the MP3/LRC case may skip when FFmpeg lacks `subtitles`.

Run: `git add src/media/background.mjs test/background.test.mjs test/helpers/create-fixtures.mjs`

Commit: `git commit -m "feat: generate cached background videos"`.

### Task 7: Port and separate audio analysis

**Files:**
- Create: `src/chart/audio-analysis.mjs`
- Create: `test/audio-analysis.test.mjs`

- [ ] **Step 1: Write failing deterministic analysis tests**

Generate 36-second mono Float32 fixtures at 11025Hz. Keep the first and last four seconds silent. Between them, place a 20ms exponentially decaying click at every beat for 110/128/156/170 BPM, make each fourth click 1.0 amplitude and other clicks 0.65, and add a second 8ms high-frequency click at each half-beat at 0.18 amplitude. Analyze these arrays directly for silence rejection, strictly increasing onset times, no peaks in silent regions, tempo within 1 BPM, and explicit BPM/offset overrides. Separately serialize one fixture to a temporary mono PCM WAV with an explicit 44-byte header, call `decodeAudioToMono(path)`, and verify sample count, duration within one sample, and representative decoded samples within float tolerance.

- [ ] **Step 2: Verify failure**

Run: `node --test test/audio-analysis.test.mjs`

Expected: missing-module failure.

- [ ] **Step 3: Extract analysis without behavior changes**

Move PCM decode, FFT, moving statistics, onset detection, periodicity, phase coherence, tempo estimation, and grid-slot creation from `/Users/teradonburi/Desktop/mp3-chart-generator/make-chart.mjs`. Implement these public boundaries:

```js
decodeAudioToMono(path, { ffmpegPath }) // => Promise<Float32Array>
function analyzeSamples(samples, { sampleRate = 11025 } = {})
// => { onset:Float64Array, peaks:Array<{time,strength,band,bands,rms}>, rms:Float64Array, duration }
function estimateTempo(analysis, { bpm, offset, minBpm = 75, maxBpm = 205 })
// => { bpm, offset, confidence, phaseCoherence }
createGridEvents(analysis, tempo, subdivision)
// => sorted Array<{index,time,sourceTime,strength,band,bands,rms}>
analyzeAudio(path, options) // => Promise<{ analysis, tempo }>
hashDecodedAudio(path, { ffmpegPath }) // => Promise<SHA256 hex string>
```

`hashDecodedAudio()` uses exactly the same canonical mono 11025Hz float PCM decode as `decodeAudioToMono()` and hashes its byte representation. Add a test that repeated calls are stable and that changing a decoded sample changes the hash. Keep constants in this module. Do not add hold/flick detection.

- [ ] **Step 4: Verify and commit**

Run: `node --test test/audio-analysis.test.mjs`

Expected: PASS for all synthetic tempos.

Run: `git add src/chart/audio-analysis.mjs test/audio-analysis.test.mjs`

Commit: `git commit -m "feat: analyze audio transients and tempo"`.

### Task 8: Chart generation and schema

**Files:**
- Create: `src/chart/generate-chart.mjs`
- Create: `src/chart/schema.mjs`
- Create: `test/generate-chart.test.mjs`
- Create: `test/chart-schema.test.mjs`

- [ ] **Step 1: Write failing generation tests**

Use a small in-memory analysis fixture. Verify easy < normal < hard density, silence bars produce no notes, four lanes satisfy `max(laneCounts) - min(laneCounts) <= ceil(noteCount * 0.2)`, seed 12345 is deterministic, different seeds can change lanes without changing times, and chords are represented only as equal-time independent tap notes.

- [ ] **Step 2: Write failing schema tests**

Cover every required field and numeric range, sorted notes, lane 0–3, tap-only type, duplicate time/lane rejection, same-time/different-lane acceptance, and stable newline-terminated JSON.

- [ ] **Step 3: Verify failure**

Run: `node --test test/generate-chart.test.mjs test/chart-schema.test.mjs`

Expected: missing-module failures.

- [ ] **Step 4: Port level design and implement schema validation**

Move only the level budgets, event ranking, spacing, deterministic RNG, lane assignment, and optional equal-time accents from the reference. Implement:

```js
function generateChart({ analysis, tempo, audioName, difficulty, lanes = 4, seed = 12345 })
// => chart object matching formatVersion 1
validateChart(chart) // => chart or throws a path-specific validation error
writeChartAtomic(chart, outputPath) // => Promise<absoluteOutputPath>
```

`generateChart()` calls `createGridEvents()` and never reads files. Add `seed` to the serialized chart. `writeChartAtomic()` must validate, write a sibling temp file, then rename.

- [ ] **Step 5: Verify Chunk 2 and commit**

Run: `npm test`

Expected: all Chunk 1–2 tests PASS.

Run: `git add src/chart/generate-chart.mjs src/chart/schema.mjs test/generate-chart.test.mjs test/chart-schema.test.mjs`

Commit: `git commit -m "feat: generate validated four-lane charts"`.

## Chunk 3: Shared renderer, alpha video, composition, and CLI

### Task 9: Perspective geometry and deterministic Canvas renderer

**Files:**
- Create: `src/render/geometry.mjs`
- Create: `src/render/canvas-renderer.mjs`
- Create: `src/render/renderer.html`
- Create: `test/geometry.test.mjs`
- Create: `test/renderer.test.mjs`

- [ ] **Step 1: Write failing geometry tests**

Verify lane centers converge to 42% of judgment width at the top, a note is at the top at `note.time - 2`, reaches the target at `note.time`, radius grows linearly, layout bounds are honored, and off-window notes are excluded.

- [ ] **Step 2: Write failing renderer-state tests**

Test pure `deriveFrameState(chart, time)`: visible notes, 120ms hit bursts, autoplay combo count, independent same-time notes, and byte-for-byte stable state for identical inputs. Use a mock Canvas object exposing `width`, `height`, and `getContext('2d')` to verify clear-to-transparent, lane lines always drawn, no lane fill, a visible judgment line/targets, circular tap notes, dark outline, inner highlight, expanding/fading hit glow during the 120ms window, combo text after the first hit, and no access to wall-clock APIs. Test normalized layout conversion at 1280×720 and 1920×1080.

- [ ] **Step 3: Verify failure**

Run: `node --test test/geometry.test.mjs test/renderer.test.mjs`

Expected: missing-module failures.

- [ ] **Step 4: Implement pure geometry and renderer modules**

Keep geometry free of DOM dependencies. Export these exact browser-compatible ESM boundaries:

```js
resolveLayout(normalizedLayout, canvasWidth, canvasHeight)
deriveFrameState(chart, timeSeconds, { travelSec = 2, hitEffectSec = 0.12 } = {})
renderFrame(canvas, chart, timeSeconds, normalizedLayout, theme, playState)
DEFAULT_THEME
```

`resolveLayout()` converts normalized values to pixel top-center, top-width, judgment-center, judgment-width, and judgment-Y. `renderFrame()` obtains the 2D context from the supplied canvas and uses `DEFAULT_THEME` when `theme` is null. It draws lane boundaries, judgment line/targets, active note circles, 120ms hit glows, and combo text from `deriveFrameState()`. `renderer.html` contains only a transparent canvas and exposes:

```js
window.renderer.initialize({ chart, layout, theme, width, height })
window.renderer.render(timeSeconds)
```

`initialize` sets exact canvas pixel dimensions and fixes `playState` to `{ mode: "autoplay" }`; `render` clears and draws one deterministic frame. Playwright serves `renderer.html`, `geometry.mjs`, and `canvas-renderer.mjs` from a temporary loopback-only Node HTTP server because browser ESM is not loaded through `file://`.

- [ ] **Step 5: Verify and commit**

Run: `node --test test/geometry.test.mjs test/renderer.test.mjs`

Expected: PASS.

Run: `git add src/render/geometry.mjs src/render/canvas-renderer.mjs src/render/renderer.html test/geometry.test.mjs test/renderer.test.mjs`

Commit: `git commit -m "feat: draw deterministic perspective gameplay"`.

### Task 10: Transparent ProRes 4444 exporter

**Files:**
- Create: `src/video/render-overlay.mjs`
- Create: `src/platform/stage-log.mjs`
- Create: `test/render-overlay.test.mjs`
- Create: `test/stage-log.test.mjs`
- Modify: `src/media/background.mjs`
- Modify: `test/background.test.mjs`

- [ ] **Step 1: Write failing frame/FFmpeg tests**

Test frame count as `ceil(duration * 30)`, timestamp as `frameIndex / 30`, Playwright screenshot settings `{ type: 'png', omitBackground: true }`, FFmpeg image2pipe input, `prores_ks`, profile 4444, `yuva444p10le`, and output duration. Test stream backpressure and child-process failure propagation. Test the loopback server only serves the three allowlisted renderer files and closes on success or failure.

- [ ] **Step 2: Verify failure**

Run: `node --test test/render-overlay.test.mjs`

Expected: missing-module failure.

- [ ] **Step 3: Add shared atomic stage-error logging**

Implement `writeStageErrorLog({ logPath, stage, command, args, code, stderr })` in `src/platform/stage-log.mjs`; use a sibling temp file and rename. Add focused tests, then refactor `createBackground()` to use it without changing behavior.

- [ ] **Step 4: Implement the explicit overlay boundary**

```js
renderOverlay({
  chart, backgroundMedia, layout, outputPath, logPath,
  ffmpegPath, ffprobePath, rendererRoot,
  launchChromiumFn, spawnProcessFn = spawnProcess, probeMediaFn = probeMedia
}) // => Promise<{ path, media, frameCount }>
```

Start the loopback-only renderer server, launch packaged Chromium headless, open `renderer.html`, set the viewport to probed background dimensions, initialize chart/layout/theme once, render each exact timestamp, and stream each PNG buffer to FFmpeg stdin while respecting `drain`. Write `gameplay-alpha.tmp.mov`; verify dimensions, 30fps, duration within one frame plus 1ms, ProRes codec, and `yuva444p10le` before rename. Close page, browser, server, and FFmpeg stdin in `finally`. On missing Chromium, emit the exact install command. On FFmpeg failure, call `writeStageErrorLog()` with stage `overlay` before rethrowing.

- [ ] **Step 5: Run the short alpha integration test**

Run: `node --test test/render-overlay.test.mjs test/stage-log.test.mjs test/background.test.mjs`

Expected: all three files PASS and FFprobe reports ProRes 4444 with alpha. If Chromium is absent, the overlay test must fail with the installation instruction rather than silently skip.

- [ ] **Step 6: Commit**

Run: `git add src/video/render-overlay.mjs src/platform/stage-log.mjs src/media/background.mjs test/render-overlay.test.mjs test/stage-log.test.mjs test/background.test.mjs`

Commit: `git commit -m "feat: export transparent gameplay video"`.

### Task 11: Final compositor and four-stage orchestrator

**Files:**
- Create: `src/video/composite.mjs`
- Create: `src/build/build-song.mjs`
- Create: `test/composite.test.mjs`
- Create: `test/build-song.test.mjs`

- [ ] **Step 1: Write failing compositor tests**

Verify overlay filter ordering, background audio mapping, H.264/AAC output, `+faststart`, 30fps, background-sized output, and exact background duration. Verify temp output validation and atomic rename. Inject an FFmpeg failure and assert `writeStageErrorLog()` receives stage `final`, executable, argument array, exit code, and stderr.

- [ ] **Step 2: Write failing orchestration tests with injected stage functions**

Verify order `background -> chart -> overlay -> final`, per-stage manifest recording, full cache hit on the second build, dependency invalidation, every force flag, resumption after an overlay failure, and chart analysis using normalized `background.mp4` audio in video mode. Verify a video-pixel-only change with identical decoded audio rebuilds background/final but keeps chart/overlay cached.

- [ ] **Step 3: Verify failure**

Run: `node --test test/composite.test.mjs test/build-song.test.mjs`

Expected: missing-module failures.

- [ ] **Step 4: Implement compositor and orchestration**

`compositeFinal({ backgroundPath, overlayPath, outputPath, logPath, ffmpegPath, ffprobePath, runProcessFn, probeMediaFn })` writes and probes `final.tmp.mp4` before rename and uses shared stage-error logging.

Use this orchestration boundary:

```js
buildSong(
  { inputPath, cliOptions, cwd, toolPaths },
  {
    createBackgroundFn, analyzeAudioFn, hashDecodedAudioFn,
    generateChartFn, writeChartFn, renderOverlayFn, compositeFinalFn,
    hashFileFn, readManifestFn, isStageHitFn, recordStageFn
  } = productionDependencies
)
// => Promise<{
//   outputDir, artifacts:{ background, chart, overlay, final, manifest },
//   stages:{ background:'build'|'cache', chart:'build'|'cache',
//            overlay:'build'|'cache', final:'build'|'cache' }
// }>
```

`hashDecodedAudioFn(path)` decodes the selected normalized audio stream to canonical mono 11025Hz float PCM and SHA-256 hashes those bytes. Store this fingerprint as background-stage manifest metadata so a background cache hit does not recompute it.

`buildSong()` computes keys from these exact subsets:

- MP3 background: MP3/LRC/cover hashes, background encoder settings, background stage version.
- Video background: source-video hash, 30fps normalization settings, background stage version.
- MP3 chart: raw MP3 hash, difficulty, seed, BPM analysis settings, chart stage version. It does not include LRC, cover, or background hash.
- Video chart: normalized `background.mp4` decoded-audio fingerprint, difficulty, seed, BPM analysis settings, chart stage version. It does not include video pixels.
- Overlay: chart artifact hash, background width/height/duration/fps metadata, layout, theme/render versions, overlay encoder version. It does not include background pixels or audio hash separately.
- Final: background artifact hash, overlay artifact hash, final encoder settings/version.

It logs `[build]` or `[cache]` per stage and returns absolute artifact paths plus per-stage cache statuses.

- [ ] **Step 5: Verify and commit**

Run: `node --test test/composite.test.mjs test/build-song.test.mjs`

Expected: PASS.

Run: `git add src/video/composite.mjs src/build/build-song.mjs test/composite.test.mjs test/build-song.test.mjs`

Commit: `git commit -m "feat: compose final video with staged caching"`.

### Task 12: CLI, launcher, and end-to-end example

**Files:**
- Create: `src/cli.mjs`
- Create: `run.command`
- Create: `test/cli.test.mjs`
- Create: `test/integration/pipeline.test.mjs`
- Modify: `package.json`
- Create: `README.md`

- [ ] **Step 1: Write failing CLI tests**

Cover `build <input>`, all documented flags, help, unknown flags, missing values, invalid difficulty/layout, exit codes, concise Japanese progress, and Unicode paths. Parse arguments without an added CLI framework.

- [ ] **Step 2: Implement CLI and thin launcher**

The executable entry point calls startup `preflight()` before any stage, then calls `buildSong()` and owns only argument/help/error presentation. `run.command` resolves its own directory and executes `node "$SCRIPT_DIR/src/cli.mjs" build "$@"`; it contains no FFmpeg or chart logic. Run `chmod +x run.command`; verify the filesystem executable bit now, and verify the Git mode after staging in Step 7.

- [ ] **Step 3: Add the complete short end-to-end test**

Generate five-second fixtures at runtime and assert:

- MP3/LRC/PNG produces all five expected files.
- Video input produces normalized background and synchronized artifacts.
- All videos are 30fps and durations agree within 34.334ms.
- Alpha MOV is ProRes with alpha; final MP4 is H.264/AAC.
- Second build reports four cache hits and does not change artifact mtimes.
- LRC change yields `background=build`, `chart=cache`, `overlay=cache`, `final=build`.
- Seed change yields `background=cache`, `chart=build`, `overlay=build`, `final=build`.
- VFR, rotation, short/long audio, missing audio, and first-track selection obey the spec.

- [ ] **Step 4: Document exact setup and commands**

README must include Node 20+, libass-enabled FFmpeg, `npm install`, `npx playwright install chromium`, sample build command, output tree, cache behavior, force flags, config schema, and troubleshooting. Do not document browser play as implemented.

- [ ] **Step 5: Run full automated verification**

Run: `npm test`

Expected: all tests PASS with no skips on the development machine.

Run: `git diff --check`

Expected: no output.

- [ ] **Step 6: Build the real tracked sample**

Run: `npm run build:example`

Expected: `output/HERE × HEAR/` contains `background.mp4`, `chart.json`, `gameplay-alpha.mov`, `final.mp4`, and `build-manifest.json`.

Run FFprobe on all three videos and verify codec, dimensions, 30fps, duration tolerance, audio mapping, and alpha. Capture representative background, alpha, and final frames and inspect them for lyric placement, spectrum, thin perspective lane lines, circular notes, transparent edges, and composite alignment.

- [ ] **Step 7: Verify the real cache and commit**

Run: `npm run build:example` again.

Expected: all four stages report `[cache]`, and artifact mtimes are unchanged.

Run: `git add src/cli.mjs run.command test/cli.test.mjs test/integration/pipeline.test.mjs package.json README.md`

Run: `git ls-files -s run.command`

Expected: mode `100755`.

Commit: `git commit -m "feat: deliver automatic chart video pipeline"`.

