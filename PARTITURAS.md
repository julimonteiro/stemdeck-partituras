# StemDeck Partituras

Extensão experimental do [StemDeck](https://github.com/stemdeckapp/stemdeck), baseada na versão 0.20.0. Mantém a licença Apache-2.0 e os créditos originais.

Adiciona geração local de rascunhos de partitura para baixo monofônico e bateria (estimativa por bandas de frequência de bumbo, caixa e chimbal), com MusicXML, MIDI, PDF, visualização e posição de reprodução.

## Estado

Em desenvolvimento. Código salvo para acompanhamento e continuidade; ainda passando por revisão e testes de integração. Resultados de transcrição precisam de revisão musical. Outras faixas ainda não são suportadas. Grade de semicolcheias e compasso com denominador 4; BPM, quantidade de tempos e início são ajustáveis.

## Código da extensão

- `app/pipeline/sheet_music.py`: análise e exportação.
- `app/api/scores.py`: fila, progresso e arquivos.
- `static/js/scores.js`, `static/css/scores.css`: interface.
- `tests/scores`: testes com áudio sintético e API.
- `docs/superpowers/plans/2026-11-01-sheet-music.md`: plano.

O aplicativo original continua documentado no README.md. A extensão usa music21, Verovio, ReportLab e svglib, além das dependências existentes. Atualizações oficiais podem sobrescrever uma instalação local modificada.
