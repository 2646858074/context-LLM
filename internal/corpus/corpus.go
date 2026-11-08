package corpus

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	mathrand "math/rand"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"context-LLM/internal/config"
)

type Answer struct {
	Answer   string `json:"answer"`
	Evidence string `json:"evidence"`
	Mode     string `json:"mode,omitempty"`
}

type Question struct {
	ID  string `json:"id"`
	Ask string `json:"ask"`
}

type QuestionSet struct {
	ResponseFormat map[string]map[string]string `json:"response_format"`
	Questions      []Question                   `json:"questions"`
}

type BenchmarkCase struct {
	ID       string
	Mode     string
	Question string
	Answer   Answer
	Records  []string
}

type Manifest struct {
	RequestedContextTokens int      `json:"requested_context_tokens"`
	ReservedHeadroomTokens int      `json:"reserved_headroom_tokens"`
	MaterialTokenTarget    int      `json:"material_token_target_estimate"`
	CharsPerTokenEstimate  float64  `json:"chars_per_token_estimate"`
	File                   string   `json:"file"`
	Characters             int      `json:"characters"`
	SHA256                 string   `json:"sha256"`
	AnchorCount            int      `json:"anchor_count"`
	TestModes              []string `json:"test_modes"`
}

func Generate(out string, tier int, seed int64, charsPerToken float64, anchorCount int, testModes []string) (Manifest, error) {
	if err := os.MkdirAll(out, 0o755); err != nil {
		return Manifest{}, err
	}
	cases := benchmarkCases(seed, anchorCount, testModes)
	if err := writeJSON(filepath.Join(out, "questions.json"), questionSet(cases)); err != nil {
		return Manifest{}, err
	}
	if err := writeJSON(filepath.Join(out, "answers.private.json"), answerSet(cases)); err != nil {
		return Manifest{}, err
	}

	material := buildMaterial(
		int(math.Round(float64(tier-config.HeadroomTokens)*charsPerToken)),
		seed+int64(tier),
		cases,
	)
	file := fmt.Sprintf("context_%dk.txt", tier/1000)
	if err := writeText(filepath.Join(out, file), material); err != nil {
		return Manifest{}, err
	}
	digest := sha256.Sum256([]byte(material))
	manifest := Manifest{
		RequestedContextTokens: tier,
		ReservedHeadroomTokens: config.HeadroomTokens,
		MaterialTokenTarget:    tier - config.HeadroomTokens,
		CharsPerTokenEstimate:  charsPerToken,
		File:                   file,
		Characters:             len(material),
		SHA256:                 hex.EncodeToString(digest[:]),
		AnchorCount:            anchorCount,
		TestModes:              append([]string(nil), testModes...),
	}
	if err := writeJSON(filepath.Join(out, "manifest.json"), []Manifest{manifest}); err != nil {
		return Manifest{}, err
	}
	return manifest, nil
}

func benchmarkCases(seed int64, anchorCount int, modes []string) []BenchmarkCase {
	rng := mathrand.New(mathrand.NewSource(seed))
	colors := []string{"amber", "cobalt", "jade", "ivory", "magenta", "ochre", "saffron", "teal"}
	animals := []string{"badger", "crane", "dolphin", "falcon", "gecko", "heron", "lynx", "otter"}
	people := []string{"Avery Chen", "Blair Imani", "Casey Rowan", "Drew Sato", "Ellis Park", "Finley Noor", "Gray Torres", "Harper Vale"}
	cases := make([]BenchmarkCase, 0, anchorCount)
	assignments := make([]string, anchorCount-1)
	for index := range assignments {
		assignments[index] = modes[index%len(modes)]
	}
	rng.Shuffle(len(assignments), func(i, j int) {
		assignments[i], assignments[j] = assignments[j], assignments[i]
	})

	for index := 1; index < anchorCount; index++ {
		qid := questionID(index)
		mode := assignments[index-1]
		value := fmt.Sprintf("%s-%s-%d", pick(rng, colors), pick(rng, animals), rng.Intn(9000)+1000)
		project := fmt.Sprintf("%s-%02d", pick(rng, animals), index)
		budget := fmt.Sprintf("%s-budget-%02d", pick(rng, colors), index)
		oldOwner := pick(rng, people)
		newOwner := pick(rng, people)
		for newOwner == oldOwner {
			newOwner = pick(rng, people)
		}

		switch mode {
		case "needle":
			cases = append(cases, BenchmarkCase{
				ID:       qid,
				Mode:     mode,
				Question: fmt.Sprintf("What is the verified retrieval value for %s?", qid),
				Answer:   Answer{Answer: value, Evidence: fmt.Sprintf("ND-%02d", index)},
				Records: []string{
					fmt.Sprintf("AUTHORITATIVE NEEDLE ND-%02d: The verified retrieval value for %s is %s.\n", index, qid, value),
				},
			})
		case "adversarial":
			cases = append(cases, BenchmarkCase{
				ID:       qid,
				Mode:     mode,
				Question: fmt.Sprintf("What is the verified retrieval value for %s?", qid),
				Answer:   Answer{Answer: value, Evidence: fmt.Sprintf("AD-%02d", index)},
				Records: []string{
					fmt.Sprintf("EARLIER REVISION LK-%02d: During an earlier revision, %s mapped to %s-%d.\n", index, qid, strings.Split(value, "-")[0], rng.Intn(9000)+1000),
					fmt.Sprintf("ADVISORY NOTE AD-NOTE-%02d: A related candidate value for %s is %s-%d.\n", index, qid, strings.Split(value, "-")[0], rng.Intn(9000)+1000),
					fmt.Sprintf("AUTHORITATIVE ADVERSARIAL AD-%02d: The verified retrieval value for %s is %s.\n", index, qid, value),
				},
			})
		case "conflict":
			cases = append(cases, BenchmarkCase{
				ID:       qid,
				Mode:     mode,
				Question: fmt.Sprintf("Who is the current owner of project %s?", project),
				Answer:   Answer{Answer: newOwner, Evidence: fmt.Sprintf("CF-OLD-%02d and CF-NEW-%02d", index, index)},
				Records: []string{
					fmt.Sprintf("POLICY CONFLICT CF-OLD-%02d: At first release, the owner of project %s was %s.\n", index, project, oldOwner),
					fmt.Sprintf("POLICY CONFLICT CF-NEW-%02d: Effective 2026-10-31, this supersedes CF-OLD-%02d; the current owner of project %s is %s.\n", index, index, project, newOwner),
				},
			})
		case "multi_hop":
			cases = append(cases, BenchmarkCase{
				ID:       qid,
				Mode:     mode,
				Question: fmt.Sprintf("Who personally approves the %s?", budget),
				Answer:   Answer{Answer: newOwner, Evidence: fmt.Sprintf("MH-ROLE-%02d and MH-APPROVAL-%02d", index, index)},
				Records: []string{
					fmt.Sprintf("ROLE RECORD MH-ROLE-%02d: The current owner of project %s is %s.\n", index, project, newOwner),
					fmt.Sprintf("APPROVAL RECORD MH-APPROVAL-%02d: The %s must be personally approved by the current owner of project %s.\n", index, budget, project),
				},
			})
		}
	}

	limitID := questionID(anchorCount)
	return append(cases, BenchmarkCase{
		ID:       limitID,
		Mode:     "abstention",
		Question: "What is the project owner's birth date? If absent, answer INSUFFICIENT.",
		Answer:   Answer{Answer: "INSUFFICIENT", Evidence: "LIMIT-01"},
		Records: []string{
			"LIMIT RECORD LIMIT-01: The records contain no birth dates, home addresses, or telephone numbers.\n",
		},
	})
}

func buildMaterial(targetChars int, seed int64, cases []BenchmarkCase) string {
	rng := mathrand.New(mathrand.NewSource(seed))
	digest := sha256.Sum256([]byte(strconv.FormatInt(seed, 10)))
	tag := hex.EncodeToString(digest[:])[:12]
	records := []string{}
	for _, testCase := range cases {
		records = append(records, testCase.Records...)
	}
	rng.Shuffle(len(records), func(i, j int) {
		records[i], records[j] = records[j], records[i]
	})

	var builder strings.Builder
	builder.Grow(targetChars + 4096)
	builder.WriteString("LONG-CONTEXT EVALUATION CORPUS " + tag + "\nAuthority order: a later POLICY RECORD supersedes an earlier POLICY RECORD; AUTHORITATIVE RECORD outranks ADVISORY and EARLIER REVISION records.\n\n")
	nextAnchor, fillerIndex := 0, 1
	for builder.Len() < targetChars {
		position := 0.03
		if len(records) > 1 {
			position += 0.93 * float64(nextAnchor) / float64(len(records)-1)
		}
		if nextAnchor < len(records) && builder.Len() >= int(float64(targetChars)*position) {
			builder.WriteString(records[nextAnchor])
			nextAnchor++
			continue
		}
		fmt.Fprintf(&builder, "Archive %s segment %06d: the operational ledger records routine catalog updates, validated shipment notes, indexed correspondence, quarterly summaries, and neutral administrative observations. No decision is implied by this routine record.\n", tag, fillerIndex)
		if fillerIndex%17 == 0 {
			fmt.Fprintf(&builder, "Filing note %s-%06d: revision bucket %d remains routine.\n", tag, fillerIndex, rng.Intn(90000)+10000)
		}
		fillerIndex++
	}
	for ; nextAnchor < len(records); nextAnchor++ {
		builder.WriteString(records[nextAnchor])
	}
	return builder.String()
}

func questionSet(cases []BenchmarkCase) QuestionSet {
	questions := make([]Question, 0, len(cases))
	for _, testCase := range cases {
		questions = append(questions, Question{ID: testCase.ID, Ask: testCase.Question})
	}
	return QuestionSet{
		ResponseFormat: map[string]map[string]string{"question_id": {"answer": "string", "evidence": "record id"}},
		Questions:      questions,
	}
}

func answerSet(cases []BenchmarkCase) map[string]Answer {
	answers := map[string]Answer{}
	for _, testCase := range cases {
		answer := testCase.Answer
		answer.Mode = testCase.Mode
		answers[testCase.ID] = answer
	}
	return answers
}

func pick(rng *mathrand.Rand, values []string) string {
	return values[rng.Intn(len(values))]
}

func questionID(index int) string {
	return fmt.Sprintf("Q%02d", index)
}

func writeJSON(path string, value any) error {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, append(data, '\n'), 0o600)
}

func writeText(path, text string) error {
	return os.WriteFile(path, []byte(text), 0o600)
}
