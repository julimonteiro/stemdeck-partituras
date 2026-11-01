# Sheet music implementation plan

Goal: Add local, editable draft sheet music for separated bass and drums, with progress, playback position, and MusicXML/MIDI/PDF downloads.
Architecture: A bounded background worker reads existing stem WAV files, detects monophonic bass pitches or experimental drum-band onsets, quantizes to user-selected tempo/meter, writes notation with music21, and engraves it with Verovio. A mixer button opens a score panel; cached results survive restarts. Existing audio stays untouched.
Defaults chosen by implementer: original pitch; 4/4 with editable BPM, meter, and first-beat offset; sixteenth-note grid; clearly label drum classification as approximate; limit input to 15 minutes. No new model downloads.

- [x] Test pitch detection, silence, percussion, ties/rests, API validation and error recovery.
- [x] Implement transcription and notation exports; verify synthetic audio and rendered notation.
- [x] Add background API with one-worker queue, progress, caching and safe paths.
- [x] Add accessible mixer panel with polling, downloads and playback position/measure navigation.
- [x] Run targeted and regression tests and independent review.
- [x] Back up installed runtime files, deploy extension, restart and smoke test live API.

Deployment: Preserve source at ~/stemdeck-local. Back up every replaced file before copying to installed runtime. Official updates may replace the extension; provide reinstall script. Existing library is never deleted.


2026-11-01: User authorized public repository and push, installation and app launch. Added user-requested four-string bass TAB with shared quantization and MusicXML fingering. Final review found MIDI tempo-offset, kit-mapping and TAB-collision issues; regression tests failed before fixes and now pass. PDF visual QA found SVG converter failures; switched to resvg-py at print resolution. Original JavaScript tests and real browser integration passed. No user audio is committed.
