# Arc-Stream 🎵⚡

> **Intelligent Energy Trajectory Music Recommendation & Autonomous DJ Mix Engine**

[![FastAPI](https://img.shields.io/badge/FastAPI-0.110+-009688.svg?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![PyTorch](https://img.shields.io/badge/PyTorch-2.2+-EE4C2C.svg?logo=pytorch&logoColor=white)](https://pytorch.org)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16%20%2B%20pgvector-336791.svg?logo=postgresql&logoColor=white)](https://github.com/pgvector/pgvector)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933.svg?logo=node.js&logoColor=white)](https://nodejs.org)
[![React](https://img.shields.io/badge/React-19-61DAFB.svg?logo=react&logoColor=black)](https://react.dev)
[![Vite](https://img.shields.io/badge/Vite-8.0-646CFF.svg?logo=vite&logoColor=white)](https://vitejs.dev)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED.svg?logo=docker&logoColor=white)](https://www.docker.com)

---

## 📖 Table of Contents

- [Overview & Purpose](#-overview--purpose)
- [How It Works](#-how-it-works)
- [Algorithms & Mathematical Formulations](#-algorithms--mathematical-formulations)
  - [1. 7D Latent Acoustic Vector Space](#1-7d-latent-acoustic-vector-space)
  - [2. Energy Trajectory Planning Curves](#2-energy-trajectory-planning-curves)
  - [3. Conditioned PyTorch Recurrent Architecture (ArcStreamLSTM)](#3-conditioned-pytorch-recurrent-architecture-arcstreamlstm)
  - [4. Acoustic Centroid Blending & Energy Pinning](#4-acoustic-centroid-blending--energy-pinning)
  - [5. Energy-Band Gated Vector Search (`pgvector`)](#5-energy-band-gated-vector-search-pgvector)
  - [6. Camelot Harmonic Key Transition Mapping](#6-camelot-harmonic-key-transition-mapping)
  - [7. LLM Prompt-to-Mix Planner (Groq Cloud API Integration)](#7-llm-prompt-to-mix-planner-groq-cloud-api-integration)
- [Architecture & Tech Stack](#-architecture--tech-stack)
- [Repository Structure](#-repository-structure)
- [Getting Started / Running Locally](#-getting-started--running-locally)
  - [Prerequisites](#prerequisites)
  - [Spotify Developer Credentials](#spotify-developer-credentials)
  - [Method 1: Docker Compose (Recommended)](#method-1-docker-compose-recommended)
  - [Method 2: Manual Local Development Setup](#method-2-manual-local-development-setup)
- [Configuration & Environment Variables](#-configuration--environment-variables)
- [API Endpoints Reference](#-api-endpoints-reference)

---

## 🎯 Overview & Purpose

Standard music streaming recommendation systems rely primarily on **static collaborative filtering** or **content-based k-nearest neighbors**. While these methods excel at finding songs similar to what you just heard, they are inherently **directionless**:
- They cannot steer energy dynamically over a multi-track set.
- They lead to sudden jarring tempo/energy leaps or monotonous auditory fatigue.
- They lack awareness of narrative pacing (e.g., club progression, workout ramp-up, study flow).

**Arc-Stream** re-imagines playlist generation and automated queue steering as an **acoustic trajectory through high-dimensional latent space**. Rather than jumping randomly between similar tracks, Arc-Stream:
1. Allows you to define an **energy curve** (asymmetric build-up/drop arc, linear ramp, sinusoidal wave, or freehand curve) or prompt an LLM in plain English (e.g., *"Cyberpunk night drive through Tokyo ramping to a driving electro peak"*).
2. Analyzes the acoustic features of your selected seed tracks.
3. Uses a **custom PyTorch LSTM** to forecast the next optimal latent track coordinates conditioned on the target energy step.
4. Performs **similarity search via PostgreSQL + pgvector** within an energy-constrained window to find the closest real song in the database without breaking the narrative arc.
5. Syncs live with your **Spotify** account for real-time playback steering, queue buffering, and one-click playlist export.

---

## 🔄 How It Works

```mermaid
flowchart TD
    subgraph UI ["Client (React 19 + Recharts + Vite)"]
        A[User Input / Spotify Seed Tracks] --> B[Trajectory Selection: Arc / Wave / Custom / Prompt]
        B --> C[Real-Time Recharts Curve & Acoustic Radar Preview]
    end

    subgraph Gateway ["Express Gateway (:3000)"]
        D[Spotify OAuth & Session Management]
        E[API Router: /api/ai/generate-playlist]
    end

    subgraph AI ["FastAPI ML Service (:8000)"]
        F[Groq AI: LLaMA 3.3 Prompt & Telemetry Planner]
        G[Trajectory Generator: Energy Curve Interpolation]
        H[Acoustic Centroid Calculation]
        I[PyTorch LSTM Next-Vector Inference]
        J[Centroid Blending: 0.55 LSTM + 0.45 Centroid]
    end

    subgraph Storage ["PostgreSQL 16 + pgvector (:5432)"]
        K[Table: track_features - 7D Vector L2 Distance]
        L[Energy-Band Gating: ±0.08 Target Energy Filter]
    end

    subgraph SpotifyAPI ["Spotify Web API"]
        M[Web Playback SDK]
        N[Export New Playlist]
    end

    C -->|Request| E
    E -->|Proxy| G
    B -.->|Natural Language Prompt| F
    F --> G
    G --> I
    A --> H
    H --> J
    I --> J
    J -->|7D Ideal Vector Query| L
    L --> K
    K -->|Matched Track & Acoustic Features| J
    J -->|Rolling Context Update| I
    AI -->|Generated Tracklist| E
    E -->|JSON Response| C
    C -->|Export / Play| M
    C -->|Save to Account| N
```

### Execution Flow:
1. **Seed Ingestion**: The user chooses 1 to 5 seed tracks (from Spotify or the local database) and selects a target energy profile (e.g., Start: `0.3`, Peak: `0.85`, Count: `12`).
2. **Curve Discretization**: The trajectory generator generates a target energy sequence $E = [e_1, e_2, \dots, e_N]$ where $e_i \in [0.0, 1.0]$.
3. **Sequential Step Prediction**:
   - The sliding context window of the last 5 track vectors is passed to the **PyTorch LSTM**, conditioned on the step's target energy $e_i$.
   - The model predicts the next 7-dimensional normalized acoustic vector $\hat{z}$.
   - The prediction is blended with the **acoustic centroid** of the initial seeds to preserve artist aesthetic and tone.
   - The energy dimension ($z[1]$) is strictly pinned to $e_i$.
4. **Vector Retrieval**: PostgreSQL queries the `track_features` table using `pgvector` Euclidean L2 distance (`<->`), restricting candidates to tracks within an energy tolerance band ($\pm 0.08$) and excluding previously played tracks.
5. **Autoregressive Step**: The retrieved track's actual feature vector is appended to the rolling history window, and step 3 repeats for the remaining track count.
6. **Playback & Export**: The final cohesive set is rendered with interactive Recharts deviation curves and exported to Spotify with a single click.

---

## 🧠 Algorithms & Mathematical Formulations

### 1. 7D Latent Acoustic Vector Space
Each track in Arc-Stream is modeled as a normalized 7-dimensional vector:
$$z = [z_{\text{danceability}}, z_{\text{energy}}, z_{\text{key}}, z_{\text{loudness}}, z_{\text{mode}}, z_{\text{tempo}}, z_{\text{valence}}] \in [0.0, 1.0]^7$$

Normalization formulas implemented in `ml-service/app/feature_utils.py`:
- **Danceability, Energy, Valence, Mode**: Naturally bounded in $[0.0, 1.0]$.
- **Key**: Pitch class integer normalized:
  $$z_{\text{key}} = \frac{\max(\text{key}, 0)}{11.0}$$
- **Loudness (dB)**: Clipped between $[-60, 0]\text{ dB}$:
  $$z_{\text{loudness}} = \frac{\text{clamp}(\text{loudness}, -60.0, 0.0) + 60.0}{60.0}$$
- **Tempo (BPM)**: Capped up to $250\text{ BPM}$:
  $$z_{\text{tempo}} = \frac{\min(\text{tempo}, 250.0)}{250.0}$$

---

### 2. Energy Trajectory Planning Curves
Implemented in `ml-service/app/trajectory.py`:

- **DJ Arc Curve (`arc`)**:
  Simulates a festival or club set where energy builds up, peaks around two-thirds into the set ($t \approx 0.65$), and resolves into an outro:
  $$e(t) = \text{start} + (\text{target} - \text{start}) \cdot \sin(\pi \cdot t^{0.8})$$
  With an alternate smooth cubic Hermite easing formulation:
  $$h(t) = t^2 (3 - 2t)$$

- **Linear Curve (`linear`)**:
  Uniform slope transitions for gradual warm-ups or cool-downs:
  $$e(t) = \text{start} + t \cdot (\text{target} - \text{start}), \quad t \in [0, 1]$$

- **Wave Curve (`wave`)**:
  Oscillating trajectory suitable for high-intensity interval training (HIIT) or contrasting moods:
  $$e(t) = \frac{\text{start} + \text{target}}{2} - \frac{\text{target} - \text{start}}{2} \cdot \cos(2\pi t)$$

- **Custom / LLM Bézier Interpolation**:
  Given arbitrary discrete anchor points $[p_1, p_2, \dots, p_k]$, Arc-Stream applies 1D linear interpolation (`np.interp`) to resample the curve into exact track count steps.

---

### 3. Conditioned PyTorch Recurrent Architecture (`ArcStreamLSTM`)
The recommendation model (`ml-service/app/model_arch.py`) predicts sequential transitions:

- **Input Dimension**: $8$ ($7$ normalized audio features + $1$ conditioned `target_energy`).
- **Layers**: 2-layer stacked LSTM, `hidden_dim = 128`, `dropout = 0.2`.
- **Feedforward Prediction Head**:
  $$\text{Linear}(128 \to 64) \longrightarrow \text{Tanh}() \longrightarrow \text{Linear}(64 \to 7) \longrightarrow \text{Sigmoid}()$$
- **Output**: 7-dimensional vector $\hat{z} \in [0, 1]^7$.

---

### 4. Acoustic Centroid Blending & Energy Pinning
To prevent the model from drifting into drastically different sonic territory across long playlists while following the energy curve, Arc-Stream uses **Centroid Anchoring**:
1. Computes the geometric acoustic mean of the initial seed tracks:
   $$\mu_{\text{seed}} = \frac{1}{|S|} \sum_{s \in S} z_s$$
2. Blends the recurrent LSTM prediction with the seed centroid:
   $$z_{\text{blended}} = 0.55 \cdot \hat{z}_{\text{LSTM}} + 0.45 \cdot \mu_{\text{seed}}$$
3. Pins the energy coordinate ($z[1]$) strictly to the curve's target energy:
   $$z_{\text{ideal}}[1] = e_{\text{target}}$$

---

### 5. Energy-Band Gated Vector Search (`pgvector`)
High-dimensional indexing uses PostgreSQL's `pgvector` extension:
1. **Band Filter**: Filters tracks matching an energy tolerance window:
   $$| \text{track.energy} - e_{\text{target}} | \le 0.08$$
2. **L2 Distance Minimization**:
   $$\arg\min_{t \notin \text{history}} \| z_t - z_{\text{ideal}} \|_2$$
3. If no track matches inside the band, it falls back to global minimum L2 vector distance to guarantee continuity without errors.

---

### 6. Camelot Harmonic Key Transition Mapping
For DJ-grade harmonic mixing compatibility, `ml-service/app/main.py` maps Spotify's raw key (0–11 chromatic pitch class) and mode (0 = Minor, 1 = Major) into the **Camelot Wheel**:
- Major keys $\to$ `B` wheel (e.g., C Major $\to$ `8B`)
- Minor keys $\to$ `A` wheel (e.g., A Minor $\to$ `8A`)
This ensures users can verify harmonic compatibility before sequencing live transitions.

---

### 7. LLM Prompt-to-Mix Planner (Groq Cloud API Integration)
In addition to manual sliders, Arc-Stream integrates with **Groq Cloud API** (running `llama-3.3-70b-versatile` by default for lightning-fast sub-second generation without needing heavy local GPU resources):
- Users input natural language descriptions (e.g. *"High-intensity gym phonk workout ramping from heavy warm-up to 150 BPM energetic peak"*).
- The planner extracts:
  - Curated playlist title and acoustic vibe summary.
  - Recommended BPM range and target valence.
  - 5 sonic aesthetic seed query strings.
  - A mathematically clamped track-by-track energy trajectory array.
- The energy curve is automatically interpolated and fed directly into the LSTM + `pgvector` pipeline.
- If the `GROQ_API_KEY` is not set or network issues occur, the system smoothly falls back to a deterministic acoustic heuristic planner without crashing.

---

## 🏗 Architecture & Tech Stack

| Layer | Technologies | Responsibility |
|---|---|---|
| **Frontend** | React 19, Vite, Recharts, Zustand, Glassmorphic CSS | Interactive trajectory graph, Radar acoustic charts, Spotify Web Playback SDK, Prompt UI |
| **API Gateway** | Node.js, Express 5, `spotify-web-api-node`, `cookie-parser` | Spotify OAuth 2.0 PKCE / refresh tokens, API proxying, playlist export |
| **ML Engine** | Python 3.11+, FastAPI, PyTorch 2.2+, NumPy, Pandas, SQLAlchemy | LSTM recurrent inference, curve calculation, Groq AI planner, pgvector bridge |
| **Database** | PostgreSQL 16, `pgvector` extension | Storing 7D vector embeddings, fast Euclidean L2 search, playlist history |
| **Orchestration** | Docker, Docker Compose | Multi-container automated networking, volume mounts, database seeding |

---

## 📁 Repository Structure

```text
Arc-stream/
├── docker-compose.yml              # Multi-container orchestration (db, ml, seed, server, client)
├── Dockerfile                      # Root multi-stage Docker build file
├── database/
│   ├── database_schema.sql         # PostgreSQL + pgvector schema definition
│   ├── populate_db.py              # Batch ingestion & 7D normalization script for dataset
│   └── check_tables.js             # Diagnostic script for schema verification
├── ml-service/
│   ├── app/
│   │   ├── main.py                 # FastAPI endpoints (/generate_playlist, /predict_buffer, etc.)
│   │   ├── model_arch.py           # PyTorch ArcStreamLSTM neural network architecture
│   │   ├── inference.py            # Latent vector prediction & tensor utilities
│   │   ├── trajectory.py           # Arc, Wave, Linear, and Interpolated curve algorithms
│   │   ├── feature_utils.py        # 7-dimension audio feature normalization
│   │   ├── config.py               # Hyperparameters (LATENT_DIM=7, SEQ_LEN=5..9)
│   │   ├── database_manager.py     # Asyncpg / SQLAlchemy database handlers
│   │   ├── weights/
│   │   │   └── arc_stream_lstm.pth # Pretrained PyTorch model weights
│   │   └── prompt/
│   │       └── groq_planner.py     # Groq API prompt-to-trajectory planner (with fallback)
│   ├── training/
│   │   ├── archive/
│   │   │   └── tracks_features.csv # Spotify tracks feature dataset
│   │   └── data_miner.py           # Training extraction pipeline
│   ├── Dockerfile                  # ML service container definition
│   └── requirements.txt            # Python dependencies
├── server/
│   ├── server.js                   # Express application entry point
│   ├── spotifyservice.js           # Spotify API SDK client configuration
│   ├── db.js                       # PostgreSQL node-pg connection pool
│   ├── components/
│   │   ├── loginRoutes.js          # Spotify OAuth login, callback, and token refresh
│   │   └── DashboardRoutes.js      # Gateway endpoints for recommendation & playback
│   ├── Dockerfile                  # Node.js backend container definition
│   └── package.json                # Server dependencies
└── client/
    ├── src/
    │   ├── components/
    │   │   ├── dashboard.jsx           # Main dashboard interface
    │   │   ├── TrajectoryGraph.jsx     # Recharts dynamic planned vs. actual energy curves
    │   │   ├── LlmPromptGenerator.jsx  # AI DJ mix prompt interface with live presets
    │   │   ├── PlaylistGenerator.jsx   # Manual curve & track selection interface
    │   │   ├── VectorRadarChart.jsx    # 7-axis acoustic radar visualization
    │   │   ├── QueueTray.jsx           # Dynamic queue preview & commit controls
    │   │   └── login.jsx               # Spotify authentication landing view
    │   ├── store/
    │   │   └── playerStore.js          # Zustand global playback & queue state
    │   └── services/
    │       └── arcApi.js               # Frontend API client
    ├── Dockerfile                  # Production Nginx client container
    └── package.json                # Frontend dependencies
```

---

## 🚀 Getting Started / Running Locally

You can run Arc-Stream either using **Docker Compose** (recommended: sets up database, seeds data, runs ML service, backend, and frontend automatically) or **manually** on your machine.

### Prerequisites

- **Git** installed on your system.
- **Docker & Docker Compose** (for Containerized setup).
- **Node.js 18+** & **npm** (for manual setup).
- **Python 3.10+** (for manual setup).
- **PostgreSQL 16** with the [`pgvector`](https://github.com/pgvector/pgvector) extension installed (for manual setup).
- A free **Spotify Developer Account** ([developer.spotify.com](https://developer.spotify.com)).

---

### Spotify Developer Credentials

To connect Arc-Stream to Spotify:
1. Go to the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) and log in.
2. Click **Create App**.
3. Fill in the App details:
   - **App Name**: `Arc-Stream`
   - **Redirect URI**: `http://127.0.0.1:3000/callback` (or `http://localhost:3000/callback`)
   - **APIs Used**: Select **Web API** and **Web Playback SDK**.
4. Save the app and note down your **Client ID** and **Client Secret**.

---

### Method 1: Docker Compose (Recommended)

Docker Compose configures PostgreSQL with `pgvector`, populates the dataset automatically on first boot, runs the FastAPI PyTorch service, the Express server, and the React frontend.

1. **Clone the repository:**
   ```bash
   git clone https://github.com/your-username/Arc-stream.git
   cd Arc-stream
   ```

2. **Configure environment variables:**
   Create or edit `server/.env`:
   ```ini
   PORT=3000
   SPOTIFY_CLIENT_ID=your_spotify_client_id_here
   SPOTIFY_CLIENT_SECRET=your_spotify_client_secret_here
   SPOTIFY_REDIRECT_URI=http://127.0.0.1:3000/callback
   FRONTEND_URL=http://localhost:5173

   DB_USER=postgres
   DB_PASSWORD=postgres
   DB_HOST=db
   DB_PORT=5432
   DB_DATABASE=arc_stream
   DATABASE_URL=postgresql://postgres:postgres@db:5432/arc_stream
   ```

3. **Start the containers:**
   ```bash
   docker compose up --build
   ```

4. **Verify the services:**
   - 🌐 **Client UI**: [http://localhost:5173](http://localhost:5173)
   - ⚡ **Express Gateway**: [http://localhost:3000](http://localhost:3000)
   - 🤖 **FastAPI ML Docs**: [http://localhost:8000/docs](http://localhost:8000/docs)
   - 🗄️ **PostgreSQL + pgvector**: `localhost:5432`

---

### Method 2: Manual Local Development Setup

If you prefer to run services natively on your host machine without Docker:

#### 1. Setup PostgreSQL with `pgvector`
Make sure PostgreSQL 16 is installed with the `vector` extension enabled.

Create a database named `arc_stream`:
```sql
CREATE DATABASE arc_stream;
\c arc_stream;
CREATE EXTENSION IF NOT EXISTS vector;
```
Execute the schema script:
```bash
psql -U postgres -d arc_stream -f database/database_schema.sql
```

#### 2. Populate the Database
Ensure `ml-service/training/archive/tracks_features.csv` is present. Then install dependencies and run the seeder:
```bash
cd ml-service
python -m venv .venv

# On Windows (PowerShell):
.venv\Scripts\Activate.ps1
# On Linux/macOS:
source .venv/bin/activate

pip install -r requirements.txt
cd ..

# Run seeder
python database/populate_db.py
```

#### 3. Run the ML Service (FastAPI)
From the `ml-service` directory with your virtual environment activated:
```bash
cd ml-service

# Create or verify ml-service/.env:
# DATABASE_URL=postgresql://postgres:your_password@localhost:5432/arc_stream

uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```
Check health: [http://localhost:8000/](http://localhost:8000/)

#### 4. Run the Express Gateway
In a new terminal window:
```bash
cd server
npm install

# Ensure server/.env has your Spotify credentials and database connection details
npm run dev
```
The server will start on [http://localhost:3000](http://localhost:3000).

#### 5. Run the Client (React + Vite)
In a new terminal window:
```bash
cd client
npm install
npm run dev
```
Open [http://localhost:5173](http://localhost:5173) in your browser.

#### 6. (Optional) Configure Groq API for Natural Language DJ Mix Planning
To enable fast, cloud-based prompt-driven playlist planning (e.g. *"Cyberpunk night drive"*):
1. Sign up for a free account at [console.groq.com](https://console.groq.com) and create an API key at [console.groq.com/keys](https://console.groq.com/keys).
2. Add the key to `ml-service/.env` (or project root `.env`):
   ```ini
   GROQ_API_KEY=gsk_your_actual_key_here
   GROQ_MODEL=llama-3.3-70b-versatile
   ```
   *(If omitted, Arc-Stream will automatically use its internal deterministic heuristic trajectory generator instead of failing).*

---

## ⚙️ Configuration & Environment Variables

### `server/.env`
| Variable | Description | Default / Example |
|---|---|---|
| `PORT` | Port for the Express gateway | `3000` |
| `SPOTIFY_CLIENT_ID` | Spotify App Client ID from developer portal | *(Required)* |
| `SPOTIFY_CLIENT_SECRET` | Spotify App Client Secret | *(Required)* |
| `SPOTIFY_REDIRECT_URI` | Spotify OAuth Callback URI | `http://127.0.0.1:3000/callback` |
| `FRONTEND_URL` | Base URL of the React Vite application | `http://localhost:5173` |
| `ML_SERVICE_URL` | Address of the FastAPI ML microservice | `http://localhost:8000` |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://postgres:password@localhost:5432/arc_stream` |

### `ml-service/.env`
| Variable | Description | Default / Example |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string for SQLAlchemy / asyncpg | `postgresql://postgres:password@localhost:5432/arc_stream` |
| `CSV_PATH` | Path to `tracks_features.csv` dataset | `./training/archive/tracks_features.csv` |
| `GROQ_API_KEY` | Groq Cloud API key from console.groq.com/keys | *(Optional - has heuristic fallback)* |
| `GROQ_MODEL` | Groq model identifier | `llama-3.3-70b-versatile` |

### `client/.env`
| Variable | Description | Default / Example |
|---|---|---|
| `VITE_NODE_BASE` | Express backend base URL | `http://127.0.0.1:3000` |

---

## 📡 API Endpoints Reference

### FastAPI AI Engine (`:8000`)
- `GET /` — Health check, database connection status, and loaded track count.
- `POST /generate_playlist` — Generates a trajectory playlist given seed track IDs, curve type (`arc`, `linear`, `wave`, `custom`), start energy, and target energy.
- `POST /generate_from_prompt` — Queries Groq AI with full seed acoustic telemetry to build a structured set plan and returns the matched tracklist.
- `POST /predict_queue` — Autoregressively forecasts the next $N$ tracks to extend an active queue.
- `POST /predict_buffer` — Predicts the immediate single next track vector from a 5–9 track sequence history.
- `GET /search_tracks?q={query}` — Searches the database by track title or artist, or returns random seed candidates.
- `GET /track_vector/{track_id}` — Returns the 7D normalized latent vector for a specific track.

### Express Gateway Server (`:3000`)
- `GET /login` — Initiates Spotify OAuth 2.0 authorization with playback & playlist scopes.
- `GET /callback` — Spotify authorization code callback handler; issues secure HTTP-only refresh cookie.
- `POST /refresh` — Refreshes the Spotify user access token.
- `POST /api/ai/generate-playlist` — Gateway proxy to ML service with Spotify metadata augmentation.
- `POST /api/ai/generate-from-prompt` — Gateway proxy for prompt-driven set generation.
- `POST /api/ai/export-playlist` — Creates a new playlist on the authenticated user's Spotify account and adds all generated tracks.
- `PUT /api/dashboard/play` — Directs playback to active Spotify devices.

---

## 📜 License & Acknowledgments

This project is open-source under the MIT License.
- **Dataset**: Spotify Audio Features (`tracks_features.csv`)
- **Vector Search Engine**: [pgvector](https://github.com/pgvector/pgvector) for PostgreSQL
- **Deep Learning Framework**: [PyTorch](https://pytorch.org)
- **UI & Visualizations**: [React](https://react.dev) & [Recharts](https://recharts.org)
