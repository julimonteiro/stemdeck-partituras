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
3. Feche e reabra o StemDeck. No Mixer, clique em **Partitura** abaixo de **Bass** ou **Drums**.
4. Para baixo, escolha **Partitura tradicional** ou **Tablatura (TAB)**, confira BPM/compasso/início e clique em **Gerar partitura**.
5. Exporte PDF, MusicXML (MuseScore) ou MIDI. Clique nos números dos compassos para posicionar o áudio.

TAB oferece 4 cordas (E1–A1–D2–G2) ou 5 cordas (B0–E1–A1–D2–G2), com 24 trastes; indica cordas/trastes também no MusicXML. A digitação escolhida é automática, não uma reconstrução da mão do músico. Notas fora desse alcance geram mensagem para usar partitura tradicional. No modo avançado, a bateria reconhece cinco famílias: bumbo, caixa, tons, chimbal e pratos. O modo clássico estima bumbo, caixa e chimbal. PDF preserva a notação com imagem de alta resolução; MusicXML continua editável.

O instalador faz backup dos arquivos substituídos em `~/Library/Application Support/StemDeck/extension-backups/`. Para desfazer, feche o app e rode `python3 scripts/restore-partituras-macos.py CAMINHO_DO_BACKUP`. A biblioteca e os arquivos de áudio são preservados. Atualizações oficiais podem exigir reinstalar a extensão.

## Validação

- `python -m pytest --confcutdir=tests/scores tests/scores -q`: áudio sintético, pausas, exportação, sincronização MIDI, mapeamento de bateria, TAB e validação da API.
- `node tests/scores/browser.mjs`: teste contra servidor de fixtures na porta 8124, cobrindo mixer, partitura/TAB, compassos, SVG e salvamento desktop. Use `SCORE_TEST_URL` para outra URL; `CHROMIUM_PATH` pode apontar para um Chromium instalado.
- `npm run test:js`: testes existentes de JavaScript.

Os dados de teste são gerados com `python tests/e2e/seed.py /tmp/stemdeck-score-e2e/jobs`. Inicie o servidor com `STEMDECK_JOBS_DIR=/tmp/stemdeck-score-e2e/jobs STEMDECK_DATA_DIR=/tmp/stemdeck-score-e2e/data python -m uvicorn app.main:app --host 127.0.0.1 --port 8124`.


## Visualização na timeline

Abaixo de **Partitura**, use o seletor **Áudio / Pauta / TAB** da faixa. Se a transcrição ainda não existe, escolha as opções e gere uma vez. O botão **Ver na timeline** também substitui a onda daquela faixa pela notação.

A nota atual e o compasso ficam destacados, com cursor alinhado ao áudio. A timeline amplia automaticamente para facilitar a leitura e rola para acompanhar a reprodução; clique numa nota para posicionar o áudio. Selecione **Áudio** para voltar à onda. O zoom e os controles de reprodução continuam disponíveis. O desenho na timeline prioriza posição no tempo; o PDF e o MusicXML oferecem a paginação musical para impressão e edição.

O seletor **Cordas do baixo** permite 4 ou 5 cordas; nesta versão a interface começa em 5 cordas. A digitação é automática e usa a menor casa disponível, podendo diferir da posição que um baixista escolheria.


## Interface integrada ao estúdio

Controles de visualização agrupados no rodapé das faixas, timeline escura com destaque âmbar e indicação das cordas. A configuração abre em um inspetor lateral alinhado ao estúdio, com ajustes avançados recolhidos. O inspetor respeita a altura dos controles de reprodução. Validado também em janela 1280×720, sem sobrepor o medidor da faixa.


## Espaçamento para leitura

A timeline calcula o zoom a partir dos ataques das notas, buscando cerca de 40 pixels entre ataques consecutivos. No modo de notação, a ampliação pode ultrapassar o limite de 10× das ondas (até 256×). Os botões − / + ao lado da visualização permitem aproximar ou afastar as notas. Ao sair da notação, o zoom anterior é restaurado. A página no inspetor também fica ampliada e permite rolagem horizontal.

O metrônomo existente pode ser ligado/desligado com K, ou no botão de metrônomo da seção Click track na barra inferior; o alto-falante ao lado ajusta o volume.


O cursor da notação compartilha a atualização e a posição percentual do cursor do áudio. A escala SVG preserva o alinhamento horizontal em qualquer ampliação; não existe compensação manual entre os cursores. Regressão verificada com rolagem horizontal em 12×, 32× e 96×.


## Tela cheia

No painel Partitura, o botão Tela cheia expande a visualização para toda a janela do aplicativo. Pauta e TAB mantêm o destaque do compasso durante a reprodução, com botões Reproduzir/Pausar no cabeçalho. Esc ou Sair da tela cheia retorna ao inspetor sem perder a transcrição.


## Transcrição avançada local

Instale com `python3 scripts/install-partituras-macos.py --neural`. No painel Partitura, escolha **Avançada · modelos locais** em **Precisão da transcrição** e gere novamente. Baixo usa Basic Pitch com conferência de afinação; bateria usa ADTOF. Áudio permanece no computador. O modelo de bateria tem restrição a uso não comercial. Consulte [modelos, licenças e limitações](docs/notation-models.md). A transcrição continua sendo um rascunho para revisar.
