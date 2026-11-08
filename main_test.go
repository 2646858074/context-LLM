package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestDefaultConfigIsLocatedBesideExecutable(t *testing.T) {
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	configPath := filepath.Join(filepath.Dir(executable), "config.txt")
	if filepath.Dir(configPath) != filepath.Dir(executable) {
		t.Fatal("default configuration is not beside the executable")
	}
}

func TestCalibration(t *testing.T) {
	actual := 189294
	result := calibrate(200000, 6.25, &actual)
	if result == nil || result.RecommendedCharsPerToken != 6.2073 {
		t.Fatalf("unexpected calibration: %#v", result)
	}
}

func TestGeneratedCorpusScoresPerfectResponse(t *testing.T) {
	root := t.TempDir()
	manifest, err := generateCorpus(root, 13000, 2026110803, 1, 13)
	if err != nil {
		t.Fatal(err)
	}
	if manifest.File != "context_13k.txt" {
		t.Fatalf("unexpected manifest: %#v", manifest)
	}
	data, err := os.ReadFile(filepath.Join(root, "answers.private.json"))
	if err != nil {
		t.Fatal(err)
	}
	answers := map[string]Answer{}
	if err := json.Unmarshal(data, &answers); err != nil {
		t.Fatal(err)
	}
	response, err := json.Marshal(answers)
	if err != nil {
		t.Fatal(err)
	}
	score := scoreResponse(root, map[string]any{"_extracted_text": string(response)}, 0)
	if score.State != "passed" || score.AnswerHits != 13 || score.EvidenceHits != 13 {
		t.Fatalf("unexpected score: %#v", score)
	}
}

func TestFiftyAnchorsGenerateAndScore(t *testing.T) {
	root := t.TempDir()
	manifest, err := generateCorpus(root, 13000, 2026110804, 1, 50)
	if err != nil {
		t.Fatal(err)
	}
	if manifest.AnchorCount != 50 {
		t.Fatalf("unexpected anchor count in manifest: %#v", manifest)
	}
	data, err := os.ReadFile(filepath.Join(root, "answers.private.json"))
	if err != nil {
		t.Fatal(err)
	}
	answers := map[string]Answer{}
	if err := json.Unmarshal(data, &answers); err != nil {
		t.Fatal(err)
	}
	if len(answers) != 50 {
		t.Fatalf("got %d answers, want 50", len(answers))
	}
	response, err := json.Marshal(answers)
	if err != nil {
		t.Fatal(err)
	}
	score := scoreResponse(root, map[string]any{"_extracted_text": string(response)}, 0)
	if score.State != "passed" || score.QuestionCount != 50 {
		t.Fatalf("unexpected 50-anchor score: %#v", score)
	}
}

func TestEvidenceToleranceRequiresCorrectAnswers(t *testing.T) {
	root := t.TempDir()
	_, err := generateCorpus(root, 13000, 2026110805, 1, 13)
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(root, "answers.private.json"))
	if err != nil {
		t.Fatal(err)
	}
	answers := map[string]Answer{}
	if err := json.Unmarshal(data, &answers); err != nil {
		t.Fatal(err)
	}
	answers["Q01"] = Answer{Answer: answers["Q01"].Answer, Evidence: "wrong-record"}
	response, _ := json.Marshal(answers)
	if score := scoreResponse(root, map[string]any{"_extracted_text": string(response)}, 0); score.State != "scored_failure" {
		t.Fatalf("zero tolerance unexpectedly passed: %#v", score)
	}
	if score := scoreResponse(root, map[string]any{"_extracted_text": string(response)}, 1); score.State != "passed" {
		t.Fatalf("one evidence miss should pass at tolerance 1: %#v", score)
	}
	answers["Q02"] = Answer{Answer: "wrong-answer", Evidence: answers["Q02"].Evidence}
	response, _ = json.Marshal(answers)
	if score := scoreResponse(root, map[string]any{"_extracted_text": string(response)}, 50); score.State != "scored_failure" {
		t.Fatalf("incorrect answer unexpectedly passed: %#v", score)
	}
}

func TestCleanupOnlyRemovesTrialDirectory(t *testing.T) {
	root := t.TempDir()
	corpus := filepath.Join(root, "200k_primary")
	if err := os.Mkdir(corpus, 0o755); err != nil {
		t.Fatal(err)
	}
	outside := filepath.Join(filepath.Dir(root), "context-LLM-outside")
	if err := os.MkdirAll(outside, 0o755); err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(outside)
	trials := []Trial{{Corpus: corpus}, {Corpus: outside}}
	deleted := cleanGeneratedFiles(root, trials)
	if len(deleted) != 1 || deleted[0] != "200k_primary" || !trials[0].TestFilesCleaned {
		t.Fatalf("unexpected cleanup: %#v, %#v", deleted, trials)
	}
	if _, err := os.Stat(outside); err != nil {
		t.Fatalf("cleanup touched outside directory: %v", err)
	}
}
