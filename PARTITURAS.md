# StemDeck Partituras

Extensão experimental do [StemDeck](https://github.com/stemdeckapp/stemdeck), baseada na versão 0.20.0. Mantém a licença Apache-2.0 e os créditos originais.

Adiciona geração local de rascunhos de partitura para baixo monofônico e bateria (estimativa por bandas de frequência de bumbo, caixa e chimbal), com MusicXML, MIDI, PDF, visualização e posição de reprodução.

## Estado

Versão experimental implementada e testada localmente. Resultados de transcrição precisam de revisão musical. Outras faixas ainda não são suportadas. Grade de semicolcheias e compasso com denominador 4; BPM, quantidade de tempos e início são ajustáveis.

## Código da extensão

- `app/pipeline/sheet_music.py`: análise e exportação.
- `app/api/scores.py`: fila, progresso e arquivos.
- `static/js/scores.js`, `static/css/scores.css`: interface.
- `tests/scores`: testes com áudio sintético e API.
- `docs/superpowers/plans/2026-11-01-sheet-music.md`: plano.

O aplicativo original continua documentado no README.md. A extensão usa music21, Verovio, ReportLab e resvg-py, além das dependências existentes. Atualizações oficiais podem sobrescrever uma instalação local modificada.


## Instalação no macOS

1. Instale o StemDeck oficial v0.20.0 e conclua sua primeira abertura.
2. Clone este repositório e execute `python3 scripts/install-partituras-macos.py`.
3. Feche e reabra o StemDeck. No Mixer, clique em **♫ Partitura** abaixo de **Bass** ou **Drums**.
4. Para baixo, escolha **Partitura tradicional** ou **Tablatura (TAB) · 4 cordas**, confira BPM/compasso/início e clique em **Gerar partitura**.
5. Exporte PDF, MusicXML (MuseScore) ou MIDI. Clique nos números dos compassos para posicionar o áudio.

TAB usa afinação padrão E1–A1–D2–G2, 24 trastes; indica cordas/trastes também no MusicXML. A digitação escolhida é automática, não uma reconstrução da mão do músico. Notas fora desse alcance geram mensagem para usar partitura tradicional. A bateria estima somente bumbo, caixa e chimbal. PDF preserva a notação com imagem de alta resolução; MusicXML continua editável.

O instalador faz backup dos arquivos substituídos em `~/Library/Application Support/StemDeck/extension-backups/`. Para desfazer, feche o app e rode `python3 scripts/restore-partituras-macos.py CAMINHO_DO_BACKUP`. A biblioteca e os arquivos de áudio são preservados. Atualizações oficiais podem exigir reinstalar a extensão.

## Validação

- `python -m pytest --confcutdir=tests/scores tests/scores -q`: áudio sintético, pausas, exportação, sincronização MIDI, mapeamento de bateria, TAB e validação da API.
- `node tests/scores/browser.mjs`: teste contra servidor de fixtures na porta 8124, cobrindo mixer, partitura/TAB, compassos, SVG e salvamento desktop. Use `SCORE_TEST_URL` para outra URL; `CHROMIUM_PATH` pode apontar para um Chromium instalado.
- `npm run test:js`: testes existentes de JavaScript.

Os dados de teste são gerados com `python tests/e2e/seed.py /tmp/stemdeck-score-e2e/jobs`. Inicie o servidor com `STEMDECK_JOBS_DIR=/tmp/stemdeck-score-e2e/jobs STEMDECK_DATA_DIR=/tmp/stemdeck-score-e2e/data python -m uvicorn app.main:app --host 127.0.0.1 --port 8124`.
