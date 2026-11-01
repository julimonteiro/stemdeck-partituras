# Optional local transcription models

## Installation

After installing the regular StemDeck runtime, run:

```sh
python3 scripts/install-partituras-macos.py --neural
```

Reopen StemDeck. In Partitura, choose **Avançada · modelos locais** and generate again. Old classic transcriptions are not reused as neural results. **Clássica · estimativa simples** remains available. Models run in the local worker; audio is not uploaded. An unavailable advanced model gives a clear error rather than silently substituting the classic result.

## Bass

[Spotify Basic Pitch](https://github.com/spotify/basic-pitch), release 0.4.0, ONNX model. Apache-2.0. The adapter restricts output to the selected standard 4/5-string range, reconciles octave disagreements with reliable pYIN support, removes overlapping harmonic notes, and preserves repeated attacks. A weak short tail is merged only when the pitch tracker supports a continuous sustained note.

The model covers piano range from A0, which includes the B0 of a standard five-string bass. This does not guarantee reliable recognition of every low note. Fingering remains an automatic suggestion; audio alone does not uniquely determine the played string/fret.

## Drums

Original [ADTOF](https://github.com/MZehren/ADTOF), by Zehren, Alunno and Bientinesi, using the optional external [ADTOF-pytorch port](https://github.com/xavriley/ADTOF-pytorch) at commit `85c192e78f716ea0b111cc8a5ee4a8f6a3a4f8a9`.

The original ADTOF material is licensed **CC BY-NC-SA 4.0**, including a non-commercial restriction. This option is intended for non-commercial research/practice. The PyTorch port has no separate explicit code license in the checked revision; it is not represented here as Apache/MIT-licensed. The optional installer obtains that external package directly; its code and model weights are **not included in this repository**. Our adapter code does not change upstream licenses. For other uses, choose a suitably licensed model or obtain permission from its owners.

Five model families are retained: kick, snare, toms, hi-hats and cymbals. Toms/cymbals are grouped, not precise identifications of every drum-kit piece. The notation uses representative General MIDI instruments. Full original sample rate is retained for the model, inference uses bounded windows with context, and confidence produces estimated velocities. Drum score timing uses a 32nd-note grid. Classification errors and missed hits remain possible.

References:

- Zehren et al., “ADTOF: A large dataset of non-synthetic music for automatic drum transcription,” ISMIR 2021.
- Zehren et al., “High-Quality and Reproducible Automatic Drum Transcription from Crowdsourced Data,” Signals 2023, [DOI](https://doi.org/10.3390/signals4040042).

## Reproducibility and runtime

- Basic Pitch ONNX SHA-256: `2c3c1d144bfa61ad236e92e169c13535c880469a12a047d4e73451f2c059a0ec`
- Converted ADTOF checkpoint SHA-256: `1bc986e596ec47ba0b44916f87cd4a39f0b2bec23596df3fb5d0e87749217320`

The worker verifies these files and requires strict ADTOF weight loading. It does not transcribe with random weights. The optional installer uses the app's existing ONNX Runtime and PyTorch. It installs the model packages without pulling their unused training/alternative inference frameworks; their upstream dependency metadata is consequently not a statement of which runtime path is used here. No TensorFlow/CoreML installation is needed for the selected ONNX path.

## Validation scope

Offline tests cover normalization, overlapping harmonics, repeated attacks, low-B string range, octave evidence, five-family percussion exports and API validation. Real installed models are also checked on a generated known-note bass signal and a local drum excerpt, through PDF/MIDI/MusicXML generation. The local music excerpt has no annotated reference: event count and successful exports are not evidence of an accuracy percentage or proof that every hit is correct. Quality on different recordings must be reviewed by ear against the source.
