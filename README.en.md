# context-LLM

English | [中文](README.md)

A dependency-free Go tool for testing the long-context reliability of OpenAI-compatible APIs.

Current version: `1.1.0`

Key capabilities:

- Test context capacity using K/M tiers
- Exact retrieval, multi-hop reasoning, conflict resolution, and adversarial distractors
- Normal and enhanced automated testing modes
- Automatic token calibration, output-headroom expansion, and error retries
- Per-mode scoring, repeated-run statistics, and complete response metadata
- Resume support, concurrent execution, and global request throttling
- Cross-platform builds for macOS, Windows, and Linux on x64/ARM64

## Quick Start

On the first run, if `config.txt` is missing beside the executable, the program creates a default configuration and exits. Edit it, then run again.

```sh
cd context-LLM
./build.sh
```

The build creates the executable for the current platform in `dist/`. The examples below use `<binary>` as a placeholder for that filename.

Replace at least these three values:

```ini
base_url = your API endpoint
model = your model ID
api_key = your API key
```

Validate the configuration without sending requests:

```sh
./<binary> --dry-run
```

Run the benchmark:

```sh
./<binary>
```

You can also run from source with an explicit configuration file:

```sh
go run . --config ./config.txt
```

## Configuration

The configuration file supports Chinese inline comments. Everything after `#` is ignored.

### Provider

| Setting | Default | Description |
|---|---|---|
| `base_url` | `https://api.openai.com/v1` | OpenAI-compatible API endpoint |
| `model` | `GPT6.1-Astra` | Model ID to test |
| `api_key` | Placeholder key | Must be replaced before a real run |
| `api_mode` | `chat-completions` | `chat-completions` or `responses` |
| `reasoning_effort` | `default` | `default` omits the parameter; options are `none/minimal/low/medium/high/xhigh/max` |
| `reasoning_summary` | `default` | Responses only; `default` omits it, options are `auto/concise/detailed` |

### Context And Output

| Setting | Default | Description |
|---|---|---|
| `tiers` | `200K, 400K, 600K, 800K, 1M` | Test tiers; supports plain numbers, K, M, and decimals |
| `chars_per_token` | `6.25` | Initial input estimate, later calibrated from actual usage |
| `max_output_tokens` | `2500` | Minimum output budget; expanded automatically by anchor count |
| `timeout_seconds` | `900` | Per-request timeout |
| `transport_retries` | `1` | Extra retries for recoverable errors |

Example:

```ini
tiers = 20K, 1.1M, 2M
```

All tiers are converted to integer tokens and validated as unique, ascending, and greater than 12K.

### Automated Testing

| Setting | Default | Description |
|---|---|---|
| `auto_calibrate` | `true` | Calibrate later tiers from actual input tokens |
| `enhanced_auto_test` | `false` | Three runs per tier, median calibration, automatic binary search |
| `structured_output` | `true` | Prefer JSON structure constraints |
| `parallel_tests` | `false` | Run the three enhanced-mode trials concurrently |
| `request_interval_ms` | `0` | Global request start interval; `0` means unlimited |

### Questions And Scoring

| Setting | Default | Description |
|---|---|---|
| `anchor_count` | `13` | Total questions, from 13 to 50 |
| `evidence_tolerance` | `0` | Allowed evidence errors per mode; values above 2 are discouraged |
| `test_modes` | All four enabled | Comma-separated question-mode switches |

Available modes:

| Mode | Capability |
|---|---|
| `needle` | Exact retrieval of distributed information |
| `multi_hop` | Reasoning across multiple records |
| `conflict` | Resolving conflicting old/new rules |
| `adversarial` | Resisting similar incorrect information |

An abstention question for insufficient material is always included.

## Test Flow

### Normal Mode

1. Generate random materials and questions for each configured tier, from smallest to largest.
2. Run one complete test per tier.
3. After `context_too_large`, retest the previous tier with new questions.
4. Calibrate later tiers from the actual `prompt_tokens`.

### Enhanced Mode

Set `enhanced_auto_test = true` to enable:

1. Three independent trials per tier, each with a new random question set.
2. Median calibration across the three input-token measurements.
3. Binary search between the passing and failing tiers at 1000-token precision.
4. Additional upward probes if every configured tier passes.

### Request Reliability

- Network failures, HTTP `408`, `429`, and recoverable `5xx` responses use exponential backoff.
- `Retry-After` is honored, with a maximum single wait of 30 seconds.
- Context-limit, authentication, and ordinary parameter errors are not retried.
- Unsupported structured-output fields fall back automatically and are recorded.
- JSON output can be extracted and repaired for code fences, trailing commas, and missing delimiters.
- `max_output_tokens` is a minimum budget; a `finish_reason=length` response triggers one automatic expansion.

## Token Usage

Before testing, estimated usage is printed per tier:

```text
Estimated usage for 200000: input 189.5K, output 2.5K, total 192.0K
```

After testing, `RESULTS.md` includes:

- Actual input, output, and total tokens for every trial
- Actual tier totals and average total usage
- Input-token average, median, and range
- Pass rate, context-limit count, failure count, and average latency
- Per-mode answer and evidence results

## Result Files

Each run is stored under:

```text
runs/run_date_time/
├── RESULTS.md
├── summary.json
├── tier_summary.json
├── run_config.public.json
└── checkpoint.json
```

After a successful run, large materials, private answers, and raw responses are deleted. Response text is not duplicated, but request ID, model, status, finish reason, usage, retries, and output-expansion metadata remain in `summary.json` and the checkpoint.

`RESULTS.md` also includes an `Errors` table showing failure type, HTTP status, error code, provider message, and retry count.

`run_config.public.json` never contains the API key.

## Resume

Resume the most recent incomplete run:

```sh
./<binary> --resume latest
```

Resume a specific run directory:

```sh
./<binary> --resume runs/run_20261108_120000
```

Resume validates the configuration fingerprint. If interruption occurred inside a tier, that tier is rerun; completed tiers, probe state, and binary-search bounds are preserved.

## Verification

Run the complete verification flow:

```sh
make verify
```

This runs formatting checks, `go vet`, and `go test -race ./...`.

Run ordinary tests only:

```sh
make test
```

## Cross-platform Builds

With no arguments, the build script detects the current system and builds only that target:

```sh
./build.sh
# or
make build
```

Build a specific target:

```sh
./build.sh windows-arm64
./build.sh linux-x64
```

Build every target:

```sh
./build.sh all
# or
make build-all
```

Supported targets:

- `macos-x64`
- `macos-arm64`
- `windows-x64`
- `windows-arm64`
- `linux-x64`
- `linux-arm64`

## GitHub Packages

The project publishes a multi-architecture container image to GitHub Packages:

```text
ghcr.io/recaeent/context-llm
```

Pull the current version:

```sh
docker pull ghcr.io/recaeent/context-llm:1.1.0
```

Run it with a prepared configuration:

```sh
docker run --rm \
  -v "$PWD/config.txt:/app/config.txt:ro" \
  ghcr.io/recaeent/context-llm:1.1.0
```

Pushing a `v*` tag automatically builds `linux/amd64` and `linux/arm64` images and publishes both `v*` and `latest` tags.

## API Key Security

- The API key is read only from `config.txt`.
- The default `sk-123456789` is a placeholder and must be replaced.
- The program does not modify existing configuration permissions; manage file access according to your operating system.
- Real keys are never written to public configuration, checkpoints, Markdown reports, or raw results.
- If a real key is stored in `config.txt`, startup warns you not to share that file.

## License

This project uses [The Unlicense](LICENSE), dedicating the software to the public domain and allowing anyone to use, modify, and redistribute it.

## Project Structure

```text
main.go                     Entry point and run orchestration
internal/config             Configuration parsing and validation
internal/corpus             Question modes, question sets, and long-context material generation
internal/provider           API requests, response parsing, and metadata
internal/scoring            Answer, evidence, and JSON repair scoring
internal/runner             Execution, retries, calibration, concurrency, and resume
internal/report             Statistics and Markdown reports
build.sh                    Cross-platform build script
Makefile                    Verification and build entry points
Dockerfile                  GHCR multi-architecture image definition
```
