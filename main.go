// context-LLM is a dependency-free long-context benchmark for OpenAI-compatible APIs.
package main

import (
	"bufio"
	"bytes"
	cryptorand "crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"math"
	mathrand "math/rand"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

const (
	headroomTokens = 12000
	instructions   = "You are being evaluated for long-context reliability. Read all material supplied below.\n" +
		"Follow the authority order stated in the corpus. Answer every question, using only the corpus.\n" +
		"Return JSON only, with exactly one object for every question id, each containing answer and evidence.\n" +
		"For information not present, use answer INSUFFICIENT. Do not add commentary.\n\n"
)

type Config struct {
	BaseURL           string
	Model             string
	APIKey            string
	APIMode           string
	Tiers             []int
	CharsPerToken     float64
	MaxOutputTokens   int
	Timeout           time.Duration
	TransportRetries  int
	AutoCalibrate     bool
	AnchorCount       int
	EvidenceTolerance int
}

type Answer struct {
	Answer   string `json:"answer"`
	Evidence string `json:"evidence"`
}

type Question struct {
	ID  string `json:"id"`
	Ask string `json:"ask"`
}

type QuestionSet struct {
	ResponseFormat map[string]map[string]string `json:"response_format"`
	Questions      []Question                   `json:"questions"`
}

type Manifest struct {
	RequestedContextTokens int     `json:"requested_context_tokens"`
	ReservedHeadroomTokens int     `json:"reserved_headroom_tokens"`
	MaterialTokenTarget    int     `json:"material_token_target_estimate"`
	CharsPerTokenEstimate  float64 `json:"chars_per_token_estimate"`
	File                   string  `json:"file"`
	Characters             int     `json:"characters"`
	SHA256                 string  `json:"sha256"`
	AnchorCount            int     `json:"anchor_count"`
}

type Score struct {
	State         string   `json:"state"`
	AnswerHits    int      `json:"answer_hits"`
	EvidenceHits  int      `json:"evidence_hits"`
	QuestionCount int      `json:"question_count"`
	Missed        []string `json:"missed,omitempty"`
	Detail        string   `json:"detail,omitempty"`
}

type Calibration struct {
	TargetPromptTokens       int     `json:"target_prompt_tokens"`
	ActualPromptTokens       int     `json:"actual_prompt_tokens"`
	CharsPerTokenUsed        float64 `json:"chars_per_token_used"`
	RecommendedCharsPerToken float64 `json:"recommended_chars_per_token"`
	DifferencePercent        float64 `json:"difference_percent"`
}

type Trial struct {
	Tier              int          `json:"tier"`
	Label             string       `json:"label"`
	Seed              int64        `json:"seed"`
	Corpus            string       `json:"corpus"`
	ResponseFile      string       `json:"response_file"`
	Attempts          int          `json:"attempts"`
	CharsPerTokenUsed float64      `json:"chars_per_token_used"`
	PromptTokens      *int         `json:"prompt_tokens,omitempty"`
	CompletionTokens  *int         `json:"completion_tokens,omitempty"`
	ElapsedSeconds    float64      `json:"elapsed_seconds"`
	ContextTooLarge   bool         `json:"context_too_large"`
	HTTPStatus        int          `json:"http_status"`
	TransportError    string       `json:"transport_error,omitempty"`
	Score             Score        `json:"score"`
	Calibration       *Calibration `json:"calibration,omitempty"`
	TestFilesCleaned  bool         `json:"test_files_cleaned,omitempty"`
}

func main() {
	configPath := flag.String("config", "", "Optional path to the benchmark configuration file")
	dryRun := flag.Bool("dry-run", false, "Validate configuration without sending requests")
	flag.Parse()
	configFile := *configPath
	if configFile == "" {
		executable, err := os.Executable()
		if err != nil {
			fatal("resolve application directory: %v", err)
		}
		configFile = filepath.Join(filepath.Dir(executable), "config.txt")
	}

	cfg, err := loadConfig(configFile, !*dryRun)
	if errors.Is(err, os.ErrNotExist) {
		if writeErr := writeDefaultConfig(configFile); writeErr != nil {
			fatal("create default configuration: %v", writeErr)
		}
		fmt.Printf("Created default configuration: %s\nEdit it if needed, then run the program again.\n", configFile)
		return
	}
	if err != nil {
		fatal("Configuration error: %v", err)
	}
	if *dryRun {
		fmt.Println("Configuration valid. No API request was sent.")
		return
	}
	if cfg.EvidenceTolerance > 2 {
		fmt.Printf("Warning: evidence_tolerance=%d weakens evidence validation; values above 2 are not recommended.\n", cfg.EvidenceTolerance)
	}

	configDir := filepath.Dir(configFile)
	runRoot := filepath.Join(configDir, "runs", "run_"+time.Now().Format("20060102_150405"))
	if err := os.MkdirAll(runRoot, 0o755); err != nil {
		fatal("create run directory: %v", err)
	}
	writeJSON(filepath.Join(runRoot, "run_config.public.json"), publicConfig(cfg))

	trials := []Trial{}
	for index, tier := range cfg.Tiers {
		fmt.Printf("Testing %s context tier …\n", comma(tier))
		primary, err := runTrial(&cfg, runRoot, tier, "primary")
		if err != nil {
			fatal("run tier %d: %v", tier, err)
		}
		trials = append(trials, primary)
		applyCalibration(&cfg, primary)

		if primary.ContextTooLarge {
			if index == 0 {
				fmt.Println("The first configured tier exceeds the model context window.")
				break
			}
			previous := cfg.Tiers[index-1]
			fmt.Printf("Context limit reached. Confirming %s with a new question set …\n", comma(previous))
			confirmation, err := runTrial(&cfg, runRoot, previous, "confirmation_new_questions")
			if err != nil {
				fatal("confirm tier %d: %v", previous, err)
			}
			trials = append(trials, confirmation)
			applyCalibration(&cfg, confirmation)
			break
		}
		if primary.Score.State != "passed" {
			fmt.Println("Stopping: the model accepted this size but did not pass the benchmark.")
			break
		}
	}

	writeJSON(filepath.Join(runRoot, "summary.json"), trials)
	writeText(filepath.Join(runRoot, "RESULTS.md"), markdownSummary(cfg, trials, runRoot))
	deleted := cleanGeneratedFiles(runRoot, trials)
	writeJSON(filepath.Join(runRoot, "summary.json"), trials)
	if len(deleted) > 0 {
		fmt.Printf("Cleaned generated test files: %s\n", strings.Join(deleted, ", "))
	}
	fmt.Printf("Finished. Results: %s\n", filepath.Join(runRoot, "RESULTS.md"))
}

func loadConfig(path string, requireKey bool) (Config, error) {
	file, err := os.Open(path)
	if err != nil {
		return Config{}, err
	}
	defer file.Close()
	sections := map[string]map[string]string{}
	section := ""
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(stripInlineComment(scanner.Text()))
		if line == "" || strings.HasPrefix(line, "#") || strings.HasPrefix(line, ";") {
			continue
		}
		if strings.HasPrefix(line, "[") && strings.HasSuffix(line, "]") {
			section = strings.TrimSpace(line[1 : len(line)-1])
			sections[section] = map[string]string{}
			continue
		}
		key, value, ok := strings.Cut(line, "=")
		if !ok || section == "" {
			return Config{}, fmt.Errorf("invalid line %q", line)
		}
		sections[section][strings.TrimSpace(key)] = strings.TrimSpace(stripInlineComment(value))
	}
	if err := scanner.Err(); err != nil {
		return Config{}, err
	}
	provider, okProvider := sections["provider"]
	bench, okBench := sections["benchmark"]
	if !okProvider || !okBench {
		return Config{}, errors.New("both [provider] and [benchmark] sections are required")
	}
	for _, key := range []string{"base_url", "model", "api_mode"} {
		if provider[key] == "" {
			return Config{}, fmt.Errorf("missing provider setting %q", key)
		}
	}
	if requireKey && provider["api_key"] == "" {
		return Config{}, errors.New("missing provider setting \"api_key\"")
	}
	if provider["api_mode"] != "chat-completions" && provider["api_mode"] != "responses" {
		return Config{}, errors.New("api_mode must be chat-completions or responses")
	}
	tiers, err := parseTiers(bench["tiers"])
	if err != nil {
		return Config{}, err
	}
	chars, err := strconv.ParseFloat(defaultString(bench["chars_per_token"], "6.25"), 64)
	if err != nil || chars <= 0 {
		return Config{}, errors.New("chars_per_token must be a positive number")
	}
	maxOutput, err := strconv.Atoi(defaultString(bench["max_output_tokens"], "2500"))
	if err != nil || maxOutput <= 0 {
		return Config{}, errors.New("max_output_tokens must be a positive integer")
	}
	timeoutSeconds, err := strconv.Atoi(defaultString(bench["timeout_seconds"], "900"))
	if err != nil || timeoutSeconds <= 0 {
		return Config{}, errors.New("timeout_seconds must be a positive integer")
	}
	retries, err := strconv.Atoi(defaultString(bench["transport_retries"], "1"))
	if err != nil || retries < 0 {
		return Config{}, errors.New("transport_retries must be zero or greater")
	}
	autoCalibrate, err := strconv.ParseBool(defaultString(bench["auto_calibrate"], "true"))
	if err != nil {
		return Config{}, errors.New("auto_calibrate must be true or false")
	}
	anchorCount, err := strconv.Atoi(defaultString(bench["anchor_count"], "13"))
	if err != nil || anchorCount < 13 || anchorCount > 50 {
		return Config{}, errors.New("anchor_count must be an integer from 13 to 50")
	}
	evidenceTolerance, err := strconv.Atoi(defaultString(bench["evidence_tolerance"], "0"))
	if err != nil || evidenceTolerance < 0 || evidenceTolerance > anchorCount {
		return Config{}, fmt.Errorf("evidence_tolerance must be an integer from 0 to %d", anchorCount)
	}
	return Config{
		BaseURL: strings.TrimRight(provider["base_url"], "/"), Model: provider["model"], APIKey: provider["api_key"], APIMode: provider["api_mode"],
		Tiers: tiers, CharsPerToken: chars, MaxOutputTokens: maxOutput, Timeout: time.Duration(timeoutSeconds) * time.Second,
		TransportRetries: retries, AutoCalibrate: autoCalibrate, AnchorCount: anchorCount, EvidenceTolerance: evidenceTolerance,
	}, nil
}

func writeDefaultConfig(path string) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return writeText(path, `# 首次启动自动生成；每个配置项均附中文说明。

[provider] # 服务商接口配置。
base_url = https://api.openai.com/v1 # OpenAI 兼容接口的根地址。
model = GPT6.1-Astra # 要测试的模型标识。
api_key = sk-123456789 # API 密钥；请替换成你自己的有效密钥。
api_mode = chat-completions # 接口模式：chat-completions 或 responses。

[benchmark] # 长上下文测试配置。
tiers = 200000, 400000, 600000, 800000, 1000000 # 依次测试的上下文 token 档位。
chars_per_token = 6.25 # 初始字符/token 估算值；程序会依据返回 token 自动校准。
max_output_tokens = 2500 # 单次请求允许的最大输出 token 数。
timeout_seconds = 900 # 单次接口请求的超时时间，单位为秒。
transport_retries = 1 # 网络或网关中断时额外重试的次数。
auto_calibrate = true # 是否将推荐的 chars_per_token 自动用于本轮后续档位。
anchor_count = 13 # 总测试识别锚点／题目数；默认 13，最多可设为 50。
# 提高锚点数会加重模型检索与输出负担；较弱模型可能漏答、JSON 格式异常或评分失败。
evidence_tolerance = 0 # 答案全对后允许证据不合格的题目数；较弱模型可设为 1 或 2，不建议超过 2。
`)
}

func stripInlineComment(value string) string {
	for _, marker := range []string{" #", " ;"} {
		if index := strings.Index(value, marker); index >= 0 {
			value = value[:index]
		}
	}
	return strings.TrimSpace(value)
}

func parseTiers(raw string) ([]int, error) {
	if raw == "" {
		return nil, errors.New("tiers is required")
	}
	values := []int{}
	seen := map[int]bool{}
	last := 0
	for _, part := range strings.Split(raw, ",") {
		tier, err := strconv.Atoi(strings.TrimSpace(part))
		if err != nil || tier <= headroomTokens || tier <= last || seen[tier] {
			return nil, fmt.Errorf("tiers must be unique, ascending integers greater than %d", headroomTokens)
		}
		values, seen[tier], last = append(values, tier), true, tier
	}
	return values, nil
}

func runTrial(cfg *Config, root string, tier int, label string) (Trial, error) {
	seed, err := randomSeed()
	if err != nil {
		return Trial{}, err
	}
	charsUsed := cfg.CharsPerToken
	corpus := filepath.Join(root, fmt.Sprintf("%dk_%s", tier/1000, label))
	manifest, err := generateCorpus(corpus, tier, seed, charsUsed, cfg.AnchorCount)
	if err != nil {
		return Trial{}, err
	}
	material, err := os.ReadFile(filepath.Join(corpus, manifest.File))
	if err != nil {
		return Trial{}, err
	}
	questions, err := os.ReadFile(filepath.Join(corpus, "questions.json"))
	if err != nil {
		return Trial{}, err
	}

	var response map[string]any
	attempts := 0
	for attempts = 1; attempts <= cfg.TransportRetries+1; attempts++ {
		started := time.Now()
		response = sendRequest(*cfg, string(material), string(questions))
		response["_benchmark"] = manifest
		response["_request"] = map[string]string{"base_url": cfg.BaseURL, "api_mode": cfg.APIMode, "model": cfg.Model}
		response["_extracted_text"] = responseText(response)
		response["_elapsed_seconds"] = math.Round(time.Since(started).Seconds()*1000) / 1000
		response["_attempt"] = attempts
		if err := writeJSON(filepath.Join(corpus, fmt.Sprintf("response_attempt_%d.json", attempts)), response); err != nil {
			return Trial{}, err
		}
		if _, interrupted := response["transport_error"]; !interrupted {
			break
		}
	}

	prompt := usageToken(response, "prompt_tokens", "input_tokens")
	completion := usageToken(response, "completion_tokens", "output_tokens")
	status := intFromAny(response["http_status"])
	if status == 0 {
		status = 200
	}
	trial := Trial{
		Tier: tier, Label: label, Seed: seed, Corpus: corpus,
		ResponseFile: filepath.Join(corpus, fmt.Sprintf("response_attempt_%d.json", attempts)), Attempts: attempts,
		CharsPerTokenUsed: charsUsed, PromptTokens: prompt, CompletionTokens: completion,
		ElapsedSeconds: floatFromAny(response["_elapsed_seconds"]), ContextTooLarge: contextTooLarge(response),
		HTTPStatus: status, TransportError: stringFromAny(response["transport_error"]), Score: scoreResponse(corpus, response, cfg.EvidenceTolerance),
	}
	trial.Calibration = calibrate(tier, charsUsed, prompt)
	if err := writeJSON(filepath.Join(corpus, "trial_summary.json"), trial); err != nil {
		return Trial{}, err
	}
	return trial, nil
}

func sendRequest(cfg Config, material, questions string) map[string]any {
	userInput := "CORPUS START\n" + material + "\nCORPUS END\nQUESTIONS\n" + questions
	endpoint := "/chat/completions"
	payload := map[string]any{}
	if cfg.APIMode == "chat-completions" {
		payload = map[string]any{"model": cfg.Model, "messages": []map[string]string{{"role": "developer", "content": instructions}, {"role": "user", "content": userInput}}, "max_tokens": cfg.MaxOutputTokens, "stream": false}
	} else {
		endpoint = "/responses"
		payload = map[string]any{"model": cfg.Model, "input": instructions + userInput, "max_output_tokens": cfg.MaxOutputTokens, "store": false}
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return map[string]any{"transport_error": "MarshalError", "error": err.Error()}
	}
	request, err := http.NewRequest(http.MethodPost, cfg.BaseURL+endpoint, bytes.NewReader(body))
	if err != nil {
		return map[string]any{"transport_error": "RequestError", "error": err.Error()}
	}
	request.Header.Set("Authorization", "Bearer "+cfg.APIKey)
	request.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: cfg.Timeout}
	result, err := client.Do(request)
	if err != nil {
		return map[string]any{"transport_error": "TransportError", "error": err.Error()}
	}
	defer result.Body.Close()
	data, err := io.ReadAll(result.Body)
	if err != nil {
		return map[string]any{"transport_error": "ReadError", "error": err.Error()}
	}
	response := map[string]any{}
	if result.StatusCode >= 400 {
		return map[string]any{"http_status": result.StatusCode, "error": string(data)}
	}
	if err := json.Unmarshal(data, &response); err != nil {
		return map[string]any{"transport_error": "DecodeError", "error": err.Error()}
	}
	return response
}

func scoreResponse(corpus string, response map[string]any, evidenceTolerance int) Score {
	expectedData, err := os.ReadFile(filepath.Join(corpus, "answers.private.json"))
	if err != nil {
		return Score{State: "request_failed", Detail: err.Error()}
	}
	expected := map[string]Answer{}
	if err := json.Unmarshal(expectedData, &expected); err != nil {
		return Score{State: "request_failed", Detail: err.Error()}
	}
	if intFromAny(response["http_status"]) >= 400 || response["transport_error"] != nil {
		return Score{State: "request_failed", QuestionCount: len(expected)}
	}
	text := strings.TrimSpace(stringFromAny(response["_extracted_text"]))
	if strings.HasPrefix(text, "```") {
		if newline := strings.Index(text, "\n"); newline >= 0 {
			text = text[newline+1:]
		}
		text = strings.TrimSuffix(strings.TrimSpace(text), "```")
	}
	actual := map[string]Answer{}
	if err := json.Unmarshal([]byte(text), &actual); err != nil {
		return Score{State: "invalid_answer_json", QuestionCount: len(expected), Detail: err.Error()}
	}
	answerHits, evidenceHits := 0, 0
	missed := []string{}
	keys := make([]string, 0, len(expected))
	for key := range expected {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		truth, found := expected[key], actual[key]
		answerOK := normalize(found.Answer) == normalize(truth.Answer)
		evidenceOK := true
		for _, required := range strings.Split(normalize(truth.Evidence), " and ") {
			if !strings.Contains(normalize(found.Evidence), required) {
				evidenceOK = false
			}
		}
		if answerOK {
			answerHits++
		}
		if evidenceOK {
			evidenceHits++
		}
		if !answerOK || !evidenceOK {
			missed = append(missed, key)
		}
	}
	state := "passed"
	if answerHits != len(expected) || len(expected)-evidenceHits > evidenceTolerance {
		state = "scored_failure"
	}
	return Score{State: state, AnswerHits: answerHits, EvidenceHits: evidenceHits, QuestionCount: len(expected), Missed: missed}
}

func generateCorpus(out string, tier int, seed int64, charsPerToken float64, anchorCount int) (Manifest, error) {
	if err := os.MkdirAll(out, 0o755); err != nil {
		return Manifest{}, err
	}
	retrievalCount := anchorCount - 3
	values := makeValues(seed, retrievalCount)
	questions := questionSet(values, retrievalCount)
	answers := answerSet(values, retrievalCount)
	if err := writeJSON(filepath.Join(out, "questions.json"), questions); err != nil {
		return Manifest{}, err
	}
	if err := writeJSON(filepath.Join(out, "answers.private.json"), answers); err != nil {
		return Manifest{}, err
	}
	material := buildMaterial(int(math.Round(float64(tier-headroomTokens)*charsPerToken)), seed+int64(tier), values, retrievalCount)
	file := fmt.Sprintf("context_%dk.txt", tier/1000)
	if err := writeText(filepath.Join(out, file), material); err != nil {
		return Manifest{}, err
	}
	digest := sha256.Sum256([]byte(material))
	manifest := Manifest{RequestedContextTokens: tier, ReservedHeadroomTokens: headroomTokens, MaterialTokenTarget: tier - headroomTokens, CharsPerTokenEstimate: charsPerToken, File: file, Characters: len(material), SHA256: hex.EncodeToString(digest[:]), AnchorCount: anchorCount}
	if err := writeJSON(filepath.Join(out, "manifest.json"), []Manifest{manifest}); err != nil {
		return Manifest{}, err
	}
	return manifest, nil
}

func makeValues(seed int64, retrievalCount int) map[string]string {
	rng := mathrand.New(mathrand.NewSource(seed))
	colors := []string{"amber", "cobalt", "jade", "ivory", "magenta", "ochre", "saffron", "teal"}
	animals := []string{"badger", "crane", "dolphin", "falcon", "gecko", "heron", "lynx", "otter"}
	projects := []string{"Aster", "Cinder", "Harbor", "Juniper", "Kestrel", "Lumen", "Mariner", "Vesper"}
	budgets := []string{"Alder", "Beryl", "Cirrus", "Dune", "Ember", "Fjord", "Grove", "Hearth"}
	people := []string{"Avery Chen", "Blair Imani", "Casey Rowan", "Drew Sato", "Ellis Park", "Finley Noor", "Gray Torres", "Harper Vale"}
	values := map[string]string{}
	for i := 1; i <= retrievalCount; i++ {
		values[questionID(i)] = fmt.Sprintf("%s-%s-%d", pick(rng, colors), pick(rng, animals), rng.Intn(9000)+1000)
	}
	values["PROJECT"] = pick(rng, projects)
	for {
		values["BUDGET"] = pick(rng, budgets)
		if values["BUDGET"] != values["PROJECT"] {
			break
		}
	}
	values["OLD_OWNER"] = pick(rng, people)
	for {
		values["NEW_OWNER"] = pick(rng, people)
		if values["NEW_OWNER"] != values["OLD_OWNER"] {
			break
		}
	}
	return values
}

func buildMaterial(targetChars int, seed int64, values map[string]string, retrievalCount int) string {
	rng := mathrand.New(mathrand.NewSource(seed))
	digest := sha256.Sum256([]byte(strconv.FormatInt(seed, 10)))
	tag := hex.EncodeToString(digest[:])[:12]
	anchors := anchorRecords(values, retrievalCount)
	var builder strings.Builder
	builder.Grow(targetChars + 4096)
	builder.WriteString("LONG-CONTEXT EVALUATION CORPUS " + tag + "\nAuthority order: a later POLICY RECORD supersedes an earlier POLICY RECORD; AUTHORITATIVE RECORD outranks a SUPERSEDED DRAFT.\n\n")
	nextAnchor, fillerIndex := 0, 1
	for builder.Len() < targetChars {
		position := 0.03
		if retrievalCount > 1 {
			position += 0.93 * float64(nextAnchor) / float64(retrievalCount-1)
		}
		if nextAnchor < retrievalCount && builder.Len() >= int(float64(targetChars)*position) {
			builder.WriteString(anchors[nextAnchor*2])
			builder.WriteString(anchors[nextAnchor*2+1])
			nextAnchor++
			continue
		}
		fmt.Fprintf(&builder, "Archive %s segment %06d: the operational ledger records routine catalog updates, validated shipment notes, indexed correspondence, quarterly summaries, and neutral administrative observations. No decision is implied by this routine record.\n", tag, fillerIndex)
		if fillerIndex%17 == 0 {
			fmt.Fprintf(&builder, "Filing note %s-%06d: revision bucket %d remains routine.\n", tag, fillerIndex, rng.Intn(90000)+10000)
		}
		fillerIndex++
	}
	for _, record := range anchors[retrievalCount*2:] {
		builder.WriteString(record)
	}
	return builder.String()
}

func anchorRecords(v map[string]string, retrievalCount int) []string {
	records := []string{}
	for i := 1; i <= retrievalCount; i++ {
		qid := questionID(i)
		records = append(records,
			fmt.Sprintf("AUTHORITATIVE RECORD AR-%02d: The verified retrieval value for %s is %s. Use this record only when answering %s.\n", i, qid, v[qid], qid),
			fmt.Sprintf("SUPERSEDED DRAFT SD-%02d: An earlier, invalid retrieval value for %s was placeholder-%02d. This draft is not authoritative.\n", i, qid, i),
		)
	}
	return append(records,
		fmt.Sprintf("POLICY RECORD PR-01: At first release, the %s project owner was %s.\n", v["PROJECT"], v["OLD_OWNER"]),
		fmt.Sprintf("POLICY RECORD PR-02: Effective 2026-10-31, this supersedes PR-01; the %s project owner is %s.\n", v["PROJECT"], v["NEW_OWNER"]),
		fmt.Sprintf("POLICY RECORD PR-03: %s budget approval must name the current %s project owner as the personal approver.\n", v["BUDGET"], v["PROJECT"]),
		fmt.Sprintf("RELATION RECORD RR-01: %s budget approval code maps to the owner role, not to a personal name.\n", v["BUDGET"]),
		"LIMIT RECORD LR-01: The records contain no birth dates, home addresses, or telephone numbers.\n",
	)
}

func questionSet(v map[string]string, retrievalCount int) QuestionSet {
	questions := []Question{}
	for i := 1; i <= retrievalCount; i++ {
		qid := questionID(i)
		questions = append(questions, Question{ID: qid, Ask: fmt.Sprintf("What is the verified retrieval value for %s?", qid)})
	}
	questions = append(questions,
		Question{ID: questionID(retrievalCount + 1), Ask: fmt.Sprintf("Who is the current %s project owner?", v["PROJECT"])},
		Question{ID: questionID(retrievalCount + 2), Ask: fmt.Sprintf("Who personally approves the %s budget?", v["BUDGET"])},
		Question{ID: questionID(retrievalCount + 3), Ask: fmt.Sprintf("What is the %s owner's birth date? If absent, answer INSUFFICIENT.", v["PROJECT"])},
	)
	return QuestionSet{ResponseFormat: map[string]map[string]string{"question_id": {"answer": "string", "evidence": "record id"}}, Questions: questions}
}

func answerSet(v map[string]string, retrievalCount int) map[string]Answer {
	answers := map[string]Answer{}
	for i := 1; i <= retrievalCount; i++ {
		qid := questionID(i)
		answers[qid] = Answer{Answer: v[qid], Evidence: fmt.Sprintf("AR-%02d", i)}
	}
	answers[questionID(retrievalCount+1)] = Answer{Answer: v["NEW_OWNER"], Evidence: "PR-02"}
	answers[questionID(retrievalCount+2)] = Answer{Answer: v["NEW_OWNER"], Evidence: "PR-02 and PR-03"}
	answers[questionID(retrievalCount+3)] = Answer{Answer: "INSUFFICIENT", Evidence: "LR-01"}
	return answers
}

func responseText(response map[string]any) string {
	if choices, ok := response["choices"].([]any); ok && len(choices) > 0 {
		if choice, ok := choices[0].(map[string]any); ok {
			if message, ok := choice["message"].(map[string]any); ok {
				return contentText(message["content"])
			}
		}
	}
	parts := []string{}
	if output, ok := response["output"].([]any); ok {
		for _, item := range output {
			itemMap, ok := item.(map[string]any)
			if !ok {
				continue
			}
			content, ok := itemMap["content"].([]any)
			if !ok {
				continue
			}
			for _, block := range content {
				blockMap, ok := block.(map[string]any)
				if !ok {
					continue
				}
				if blockMap["type"] == "output_text" {
					parts = append(parts, stringFromAny(blockMap["text"]))
				}
			}
		}
	}
	return strings.Join(parts, "")
}

func contentText(content any) string {
	if text, ok := content.(string); ok {
		return text
	}
	parts := []string{}
	if blocks, ok := content.([]any); ok {
		for _, block := range blocks {
			if item, ok := block.(map[string]any); ok {
				parts = append(parts, stringFromAny(item["text"]))
			}
		}
	}
	return strings.Join(parts, "")
}

func usageToken(response map[string]any, names ...string) *int {
	usage, ok := response["usage"].(map[string]any)
	if !ok {
		return nil
	}
	for _, name := range names {
		if value := intFromAny(usage[name]); value > 0 {
			return &value
		}
	}
	return nil
}

func calibrate(tier int, chars float64, actual *int) *Calibration {
	if actual == nil || *actual == 0 {
		return nil
	}
	target := tier - headroomTokens
	recommended := chars * float64(target) / float64(*actual)
	return &Calibration{TargetPromptTokens: target, ActualPromptTokens: *actual, CharsPerTokenUsed: chars, RecommendedCharsPerToken: math.Round(recommended*10000) / 10000, DifferencePercent: math.Round((float64(*actual)/float64(target)-1)*100) / 100}
}

func applyCalibration(cfg *Config, trial Trial) {
	if trial.Calibration == nil {
		return
	}
	fmt.Printf("Actual input: %s tokens; recommended chars_per_token: %.4f\n", comma(trial.Calibration.ActualPromptTokens), trial.Calibration.RecommendedCharsPerToken)
	if cfg.AutoCalibrate && !trial.ContextTooLarge {
		cfg.CharsPerToken = trial.Calibration.RecommendedCharsPerToken
		fmt.Println("Using this calibrated value for the following tiers in this run.")
	}
}

func contextTooLarge(response map[string]any) bool {
	detail := strings.ToLower(stringFromAny(response["error"]))
	return strings.Contains(detail, "context_too_large") || strings.Contains(detail, "exceeds the context window") || strings.Contains(detail, "context length")
}

func cleanGeneratedFiles(root string, trials []Trial) []string {
	rootAbs, err := filepath.Abs(root)
	if err != nil {
		return nil
	}
	deleted := []string{}
	for i := range trials {
		corpusAbs, err := filepath.Abs(trials[i].Corpus)
		if err != nil || filepath.Dir(corpusAbs) != rootAbs {
			continue
		}
		info, err := os.Stat(corpusAbs)
		if err != nil || !info.IsDir() {
			continue
		}
		if err := os.RemoveAll(corpusAbs); err == nil {
			trials[i].TestFilesCleaned = true
			deleted = append(deleted, filepath.Base(corpusAbs))
		}
	}
	return deleted
}

func markdownSummary(cfg Config, trials []Trial, root string) string {
	lines := []string{"# Long-context benchmark result", "", "- Provider: `" + cfg.BaseURL + "`", "- Model: `" + cfg.Model + "`", "- Run folder: `" + filepath.Base(root) + "`", "- Evidence tolerance: `" + strconv.Itoa(cfg.EvidenceTolerance) + "` (all answers must still be correct).", "- API key is intentionally excluded from all saved files."}
	for i := len(trials) - 1; i >= 0; i-- {
		if trials[i].Calibration != nil {
			lines = append(lines, fmt.Sprintf("- Recommended `chars_per_token` for the next run: `%.4f`.", trials[i].Calibration.RecommendedCharsPerToken))
			break
		}
	}
	lines = append(lines, "", "| Configured tier | Trial | CPT used | Actual input tokens | Recommended CPT | Result | Score |", "|---:|---|---:|---:|---:|---|---|")
	for _, trial := range trials {
		actual, recommended := "—", "—"
		if trial.PromptTokens != nil {
			actual = comma(*trial.PromptTokens)
		}
		if trial.Calibration != nil {
			recommended = fmt.Sprintf("%.4f", trial.Calibration.RecommendedCharsPerToken)
		}
		result := trial.Score.State
		if trial.ContextTooLarge {
			result = "context limit"
		}
		score := fmt.Sprintf("%d/%d answers; %d/%d evidence", trial.Score.AnswerHits, trial.Score.QuestionCount, trial.Score.EvidenceHits, trial.Score.QuestionCount)
		lines = append(lines, fmt.Sprintf("| %s | %s | %.4f | %s | %s | %s | %s |", comma(trial.Tier), trial.Label, trial.CharsPerTokenUsed, actual, recommended, result, score))
	}
	return strings.Join(lines, "\n") + "\n"
}

func publicConfig(cfg Config) map[string]any {
	return map[string]any{"base_url": cfg.BaseURL, "model": cfg.Model, "api_mode": cfg.APIMode, "tiers": cfg.Tiers, "chars_per_token": cfg.CharsPerToken, "max_output_tokens": cfg.MaxOutputTokens, "timeout_seconds": int(cfg.Timeout.Seconds()), "transport_retries": cfg.TransportRetries, "auto_calibrate": cfg.AutoCalibrate, "anchor_count": cfg.AnchorCount, "evidence_tolerance": cfg.EvidenceTolerance}
}

func writeJSON(path string, value any) error {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, append(data, '\n'), 0o600)
}
func writeText(path, text string) error { return os.WriteFile(path, []byte(text), 0o600) }
func randomSeed() (int64, error) {
	var raw [8]byte
	if _, err := cryptorand.Read(raw[:]); err != nil {
		return 0, err
	}
	return int64(binary.BigEndian.Uint64(raw[:]) & math.MaxInt64), nil
}
func pick(rng *mathrand.Rand, values []string) string { return values[rng.Intn(len(values))] }
func questionID(index int) string                     { return fmt.Sprintf("Q%02d", index) }
func defaultString(value, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}
func normalize(value string) string { return strings.ToLower(strings.Join(strings.Fields(value), " ")) }
func stringFromAny(value any) string {
	if value == nil {
		return ""
	}
	if text, ok := value.(string); ok {
		return text
	}
	data, err := json.Marshal(value)
	if err != nil {
		return fmt.Sprint(value)
	}
	return string(data)
}
func intFromAny(value any) int {
	switch number := value.(type) {
	case int:
		return number
	case int64:
		return int(number)
	case float64:
		return int(number)
	case json.Number:
		result, _ := number.Int64()
		return int(result)
	default:
		return 0
	}
}
func floatFromAny(value any) float64 {
	switch number := value.(type) {
	case float64:
		return number
	case int:
		return float64(number)
	default:
		return 0
	}
}
func comma(value int) string             { return strconv.FormatInt(int64(value), 10) }
func fatal(format string, values ...any) { fmt.Fprintf(os.Stderr, format+"\n", values...); os.Exit(1) }
