# Local transcription upgrade

Replace the draft DSP-only path with an optional advanced local path for bass and drums. Preserve a selectable classic path and all existing exports/timeline/full-window controls.

- Bass: Spotify Basic Pitch 0.4.0 ONNX, restricted to standard 4/5-string range, reconciled with high-confidence pYIN support; discard overlapping octave harmonics rather than emitting impossible polyphony.
- Drums: optional external ADTOF-pytorch (commit 85c192e78f716ea0b111cc8a5ee4a8f6a3a4f8a9), pretrained ADTOF Frame-RNN. Five classes: kick, snare, tom, hi-hat, cymbal. CPU inference, bounded chunks with context; fail clearly if weights missing.
- Do not include external model weights or ADTOF source in the public repository. ADTOF original material is CC BY-NC-SA 4.0; document non-commercial scope and upstream sources. The optional port does not state a separate code license; do not describe it as Apache/MIT or redistribute it.
- Install model packages without dependency resolution after installing their small missing helpers, to preserve the desktop runtime's working torch/onnx/numpy versions. Pin downloaded releases/commit. Installer has explicit --neural option.
- Cache version and method must distinguish new results. Report the actual engine used; do not silently label a classic fallback as advanced.
- Tests: event normalization and low B, overlapping harmonics/repeated attacks, confidence handling, five-part percussion MusicXML/MIDI, API method validation, real model smoke tests, existing browser checks.
- Evaluation: use short synthetic known-note fixtures and local excerpts; real recordings have no annotated reference, so report functional output and observations, not invented accuracy percentages.
