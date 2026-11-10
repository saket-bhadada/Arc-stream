# AI Prompt DJ

The Prompt DJ bar posts a vibe description to the Node gateway. Node relays it to FastAPI and queues the returned Spotify tracks; FastAPI alone calls the LLM, maps its numeric targets through the existing LSTM and pgvector search, and returns tracks plus display-only targets.

## Data source and pool

Prompt DJ requires the Kaggle [Spotify Tracks Dataset](https://www.kaggle.com/datasets/maharshipandya/-spotify-tracks-dataset) as `ml-service/training/dataset.csv`. Its columns include `track_id`, `track_name`, `artists`, `popularity`, `energy`, `valence`, `danceability`, and `tempo`. The dataset is licensed under ODbL 1.0; follow its attribution and share-alike terms when redistributing derived database contents.

The `popularity` score is used as a proxy for “most listened” because the dataset does not provide play counts. It reflects Spotify's popularity algorithm, including recency, rather than a raw lifetime stream count. At FastAPI startup, the CSV is read into memory, invalid identity rows are dropped, duplicate IDs and then duplicate name/artist pairs are removed, and the most popular tracks are retained. The final pool IDs are held in memory only; Prompt DJ seed selection and pgvector candidate queries are restricted to those IDs.

`LLM_TOP_N` defaults to 10000 and can be overridden in the FastAPI environment. `LLM_POOL_CSV_PATH` defaults to `ml-service/training/dataset.csv` for a local FastAPI run. Docker Compose uses `/data/training/dataset.csv`, backed by the `ml-service/training` directory mount. The current `training/archive/tracks_features.csv` is a separate file and is not a suitable pool source: it has no popularity column.

For Render or another container deployment, provide the CSV at the configured `LLM_POOL_CSV_PATH`; it is intentionally not bundled in the source image. `render.yaml` declares the provider, model, timeout, pool-size, CSV-path, and Ollama URL environment variables for service configuration.

## LLM configuration

Set these variables in the environment where FastAPI runs:

| Variable | Description |
|---|---|
| `LLM_PROVIDER` | `groq` or `ollama`; default is `groq`. |
| `LLM_MODEL` | Required model name. There is no model default in the new Prompt DJ client. |
| `LLM_TIMEOUT_S` | Request timeout in seconds. Defaults to 10 for Groq and 120 for Ollama; set a larger value for slower local models. |
| `GROQ_API_KEY` | Required only when `LLM_PROVIDER=groq`. Never log or commit this value. |
| `OLLAMA_BASE_URL` | Optional. Defaults to `http://localhost:11434/v1`; Docker Compose defaults it to `http://host.docker.internal:11434/v1`. |
| `LLM_POOL_CSV_PATH` | Optional CSV path override; defaults to `ml-service/training/dataset.csv` locally. |
| `LLM_TOP_N` | Optional pool-size override; defaults to 10000. |

Both committed `.env.example` files contain placeholders only. Copy the Kaggle CSV into the ignored `ml-service/training/dataset.csv`; do not commit the dataset or a real `.env`.

## Data handling guarantee

The user prompt is sent to the configured LLM at request time and is not logged or persisted by this feature. The LLM response is parsed in-flight, clamped to valid numeric ranges, and used only to select seeds, condition the LSTM, and rerank tracks. No LLM output, summary, or prompt is written to a file, cached, or added to a database table or column. Existing `/buffer` `prediction_history` writes are unchanged; Prompt DJ does not create history rows containing LLM-derived targets. If the provider times out, is unavailable, or returns invalid JSON, a keyword parser supplies safe fallback targets.

## Pre-existing issues

- The repository does not track `ml-service/training/dataset.csv`. Its existing `training/archive/tracks_features.csv` has `id` and `name` columns and no `popularity`; it cannot produce a popularity-ranked pool. Prompt DJ requires the separate dataset described above.
- The existing non-Prompt-DJ `/generate_playlist` and `/generate_from_prompt` paths use their prior SQLAlchemy/full-table selection behavior. They are intentionally unchanged; only the new Prompt DJ path is pool restricted.
- The existing frontend lint suite reports unused `accessToken` bindings in `LlmPromptGenerator.jsx` and `PlaylistGenerator.jsx`, a synchronous state update inside an effect in `LlmPromptGenerator.jsx`, and unused `curve`/`title` callback parameters in `dashboard.jsx`. These are outside this feature and were left unchanged.
