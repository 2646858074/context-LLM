package report

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"context-LLM/internal/config"
	"context-LLM/internal/runner"
)

type TierStats struct {
	Tier                    int     `json:"tier"`
	Status                  string  `json:"status"`
	Trials                  int     `json:"trials"`
	Passed                  int     `json:"passed"`
	PassRatePercent         float64 `json:"pass_rate_percent"`
	ContextLimits           int     `json:"context_limits"`
	Failed                  int     `json:"failed"`
	PromptTokensSamples     int     `json:"prompt_tokens_samples"`
	PromptTokensAverage     float64 `json:"prompt_tokens_average,omitempty"`
	PromptTokensMedian      int     `json:"prompt_tokens_median,omitempty"`
	PromptTokensMin         int     `json:"prompt_tokens_min,omitempty"`
	PromptTokensMax         int     `json:"prompt_tokens_max,omitempty"`
	CompletionTokensSamples int     `json:"completion_tokens_samples"`
	CompletionTokensAverage float64 `json:"completion_tokens_average,omitempty"`
	PromptTokensTotal       int     `json:"prompt_tokens_total,omitempty"`
	CompletionTokensTotal   int     `json:"completion_tokens_total,omitempty"`
	TotalTokensSamples      int     `json:"total_tokens_samples,omitempty"`
	TotalTokensTotal        int     `json:"total_tokens_total,omitempty"`
	TotalTokensAverage      float64 `json:"total_tokens_average,omitempty"`
	ElapsedSecondsAverage   float64 `json:"elapsed_seconds_average,omitempty"`
}

type UsageEstimate struct {
	Tier         int `json:"tier"`
	InputTokens  int `json:"input_tokens"`
	OutputTokens int `json:"output_tokens"`
	TotalTokens  int `json:"total_tokens"`
}

func Markdown(cfg config.Config, trials []runner.Trial, root string) string {
	lines := []string{
		"# Long-context benchmark result",
		"",
		"- Provider: `" + cfg.BaseURL + "`",
		"- Model: `" + cfg.Model + "`",
		"- Run folder: `" + filepath.Base(root) + "`",
		"- Test modes: `" + strings.Join(cfg.TestModes, ",") + "`",
		"- Evidence tolerance: `" + strconv.Itoa(cfg.EvidenceTolerance) + "` (all answers must still be correct).",
		"- Response metadata: preserved in `summary.json` and the checkpoint; message content is excluded.",
		"- API key is intentionally excluded from all saved files.",
	}
	for i := len(trials) - 1; i >= 0; i-- {
		if calibration := calibrationForTrial(cfg, trials, trials[i]); calibration != nil {
			lines = append(lines, fmt.Sprintf("- Recommended `chars_per_token` for the next run: `%.4f` (median of %d trial(s)).", calibration.RecommendedCharsPerToken, len(trialsForTier(trials, trials[i].Tier))))
			break
		}
	}
	stats := Aggregate(trials)
	lines = append(lines, "", "## Tier summary", "", "| Tier | Status | Trials | Passed | Pass rate | Context limits | Failed | Input avg | Input median | Input range | Input total | Output avg | Output total | Total avg | Latency avg |", "|---:|---|---:|---:|---:|---:|---:|---:|---:|---|---:|---:|---:|---:|---:|")
	for _, stat := range stats {
		inputAverage, inputMedian, inputRange := "—", "—", "—"
		if stat.PromptTokensSamples > 0 {
			inputAverage = formatK(int(stat.PromptTokensAverage))
			inputMedian = formatK(stat.PromptTokensMedian)
			inputRange = fmt.Sprintf("%s–%s", formatK(stat.PromptTokensMin), formatK(stat.PromptTokensMax))
		}
		outputAverage := "—"
		inputTotal, outputTotal, totalAverage := "—", "—", "—"
		if stat.CompletionTokensSamples > 0 {
			outputAverage = formatK(int(stat.CompletionTokensAverage))
		}
		if stat.PromptTokensTotal > 0 {
			inputTotal = formatK(stat.PromptTokensTotal)
		}
		if stat.CompletionTokensTotal > 0 {
			outputTotal = formatK(stat.CompletionTokensTotal)
		}
		if stat.TotalTokensSamples > 0 {
			totalAverage = formatK(int(stat.TotalTokensAverage))
		}
		lines = append(lines, fmt.Sprintf(
			"| %s | %s | %d | %d | %.1f%% | %d | %d | %s | %s | %s | %s | %s | %s | %s | %.2fs |",
			comma(stat.Tier),
			stat.Status,
			stat.Trials,
			stat.Passed,
			stat.PassRatePercent,
			stat.ContextLimits,
			stat.Failed,
			inputAverage,
			inputMedian,
			inputRange,
			outputAverage,
			inputTotal,
			outputTotal,
			totalAverage,
			stat.ElapsedSecondsAverage,
		))
	}
	lines = append(lines, "", "| Configured tier | Trial | CPT used | Actual input | Actual output | Actual total | Recommended CPT | Output limit | Result | Score |", "|---:|---|---:|---:|---:|---:|---:|---:|---|---|")
	for _, trial := range trials {
		actual, recommended := "—", "—"
		actualOutput, actualTotal := "—", "—"
		if trial.PromptTokens != nil {
			actual = formatK(*trial.PromptTokens)
		}
		if trial.CompletionTokens != nil {
			actualOutput = formatK(*trial.CompletionTokens)
		}
		if trial.PromptTokens != nil && trial.CompletionTokens != nil {
			actualTotal = formatK(*trial.PromptTokens + *trial.CompletionTokens)
		}
		if calibration := calibrationForTrial(cfg, trials, trial); calibration != nil {
			recommended = fmt.Sprintf("%.4f", calibration.RecommendedCharsPerToken)
		}
		outputLimit := "—"
		if trial.MaxOutputTokensUsed > 0 {
			outputLimit = comma(trial.MaxOutputTokensUsed)
		}
		result := trial.Score.State
		if trial.ContextTooLarge {
			result = "context limit"
		}
		score := fmt.Sprintf("%d/%d answers; %d/%d evidence", trial.Score.AnswerHits, trial.Score.QuestionCount, trial.Score.EvidenceHits, trial.Score.QuestionCount)
		if trial.Score.Repaired {
			score += "; repaired JSON"
		}
		lines = append(lines, fmt.Sprintf("| %s | %s | %.4f | %s | %s | %s | %s | %s | %s | %s |", comma(trial.Tier), trial.Label, trial.CharsPerTokenUsed, actual, actualOutput, actualTotal, recommended, outputLimit, result, score))
	}
	lines = append(lines, "", "## Mode breakdown", "", "| Tier | Trial | Mode | Answers | Evidence | Missed |", "|---:|---|---|---:|---:|---|")
	for _, trial := range trials {
		if len(trial.Score.ByMode) == 0 {
			continue
		}
		modes := make([]string, 0, len(trial.Score.ByMode))
		for mode := range trial.Score.ByMode {
			modes = append(modes, mode)
		}
		sort.Strings(modes)
		for _, mode := range modes {
			modeScore := trial.Score.ByMode[mode]
			lines = append(lines, fmt.Sprintf(
				"| %s | %s | %s | %d/%d | %d/%d | %s |",
				comma(trial.Tier),
				trial.Label,
				mode,
				modeScore.AnswerHits,
				modeScore.QuestionCount,
				modeScore.EvidenceHits,
				modeScore.QuestionCount,
				strings.Join(modeScore.Missed, ", "),
			))
		}
	}
	return strings.Join(lines, "\n") + "\n"
}

func trialsForTier(trials []runner.Trial, tier int) []runner.Trial {
	group := []runner.Trial{}
	for _, trial := range trials {
		if trial.Tier == tier && trial.PromptTokens != nil {
			group = append(group, trial)
		}
	}
	return group
}

func calibrationForTrial(cfg config.Config, trials []runner.Trial, target runner.Trial) *runner.Calibration {
	if !cfg.EnhancedAutoTest {
		return target.Calibration
	}
	group := trialsForTier(trials, target.Tier)
	if len(group) == 0 {
		return nil
	}
	return runner.CalibrateFromTrials(target.Tier, target.CharsPerTokenUsed, group)
}

func PublicConfig(cfg config.Config) map[string]any {
	return map[string]any{
		"base_url":            cfg.BaseURL,
		"model":               cfg.Model,
		"api_mode":            cfg.APIMode,
		"tiers":               cfg.Tiers,
		"chars_per_token":     cfg.CharsPerToken,
		"max_output_tokens":   cfg.MaxOutputTokens,
		"timeout_seconds":     int(cfg.Timeout.Seconds()),
		"transport_retries":   cfg.TransportRetries,
		"auto_calibrate":      cfg.AutoCalibrate,
		"enhanced_auto_test":  cfg.EnhancedAutoTest,
		"structured_output":   cfg.StructuredOutput,
		"parallel_tests":      cfg.ParallelTests,
		"request_interval_ms": cfg.RequestIntervalMS,
		"anchor_count":        cfg.AnchorCount,
		"evidence_tolerance":  cfg.EvidenceTolerance,
		"test_modes":          cfg.TestModes,
	}
}

func Aggregate(trials []runner.Trial) []TierStats {
	if len(trials) == 0 {
		return nil
	}
	grouped := map[int][]runner.Trial{}
	order := []int{}
	for _, trial := range trials {
		if _, exists := grouped[trial.Tier]; !exists {
			order = append(order, trial.Tier)
		}
		grouped[trial.Tier] = append(grouped[trial.Tier], trial)
	}

	stats := make([]TierStats, 0, len(order))
	for _, tier := range order {
		group := grouped[tier]
		stat := TierStats{Tier: tier, Trials: len(group)}
		promptValues := []int{}
		completionValues := []int{}
		totalValues := []int{}
		elapsedValues := []float64{}
		for _, trial := range group {
			if !trial.ContextTooLarge && trial.Score.State == "passed" {
				stat.Passed++
			} else if trial.ContextTooLarge {
				stat.ContextLimits++
			} else {
				stat.Failed++
			}
			if trial.PromptTokens != nil && *trial.PromptTokens > 0 {
				promptValues = append(promptValues, *trial.PromptTokens)
			}
			if trial.CompletionTokens != nil && *trial.CompletionTokens > 0 {
				completionValues = append(completionValues, *trial.CompletionTokens)
			}
			if trial.PromptTokens != nil && trial.CompletionTokens != nil && *trial.PromptTokens > 0 && *trial.CompletionTokens > 0 {
				totalValues = append(totalValues, *trial.PromptTokens+*trial.CompletionTokens)
			}
			elapsedValues = append(elapsedValues, trial.ElapsedSeconds)
		}
		stat.PassRatePercent = float64(stat.Passed) / float64(stat.Trials) * 100
		stat.Status = tierStatus(stat)
		stat.PromptTokensSamples = len(promptValues)
		if len(promptValues) > 0 {
			sort.Ints(promptValues)
			stat.PromptTokensAverage = averageInts(promptValues)
			stat.PromptTokensMedian = promptValues[len(promptValues)/2]
			stat.PromptTokensMin = promptValues[0]
			stat.PromptTokensMax = promptValues[len(promptValues)-1]
			stat.PromptTokensTotal = sumInts(promptValues)
		}
		stat.CompletionTokensSamples = len(completionValues)
		if len(completionValues) > 0 {
			stat.CompletionTokensAverage = averageInts(completionValues)
			stat.CompletionTokensTotal = sumInts(completionValues)
		}
		stat.TotalTokensSamples = len(totalValues)
		if len(totalValues) > 0 {
			stat.TotalTokensTotal = sumInts(totalValues)
			stat.TotalTokensAverage = averageInts(totalValues)
		}
		if len(elapsedValues) > 0 {
			stat.ElapsedSecondsAverage = averageFloats(elapsedValues)
		}
		stats = append(stats, stat)
	}
	return stats
}

func tierStatus(stat TierStats) string {
	switch {
	case stat.Passed == stat.Trials:
		return "passed"
	case stat.ContextLimits > 0 && stat.Passed == 0:
		return "context_limit"
	default:
		return "partial"
	}
}

func averageInts(values []int) float64 {
	total := 0
	for _, value := range values {
		total += value
	}
	return float64(total) / float64(len(values))
}

func sumInts(values []int) int {
	total := 0
	for _, value := range values {
		total += value
	}
	return total
}

func averageFloats(values []float64) float64 {
	total := 0.0
	for _, value := range values {
		total += value
	}
	return total / float64(len(values))
}

func WriteJSON(path string, value any) error {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, append(data, '\n'), 0o600)
}

func WriteSummary(runRoot string, cfg config.Config, trials []runner.Trial) error {
	if err := WriteJSON(filepath.Join(runRoot, "summary.json"), trials); err != nil {
		return err
	}
	if err := WriteJSON(filepath.Join(runRoot, "tier_summary.json"), Aggregate(trials)); err != nil {
		return err
	}
	return WriteText(filepath.Join(runRoot, "RESULTS.md"), Markdown(cfg, trials, runRoot))
}

func WriteText(path, text string) error {
	return os.WriteFile(path, []byte(text), 0o600)
}

func comma(value int) string {
	return strconv.FormatInt(int64(value), 10)
}

func EstimateUsage(cfg config.Config) []UsageEstimate {
	const estimatedInputOverheadTokens = 1500
	outputTokens := runner.OutputLimitFor(cfg.AnchorCount, cfg.MaxOutputTokens)
	estimates := make([]UsageEstimate, 0, len(cfg.Tiers))
	for _, tier := range cfg.Tiers {
		inputTokens := tier - config.HeadroomTokens + estimatedInputOverheadTokens
		if inputTokens < 0 {
			inputTokens = 0
		}
		estimates = append(estimates, UsageEstimate{
			Tier:         tier,
			InputTokens:  inputTokens,
			OutputTokens: outputTokens,
			TotalTokens:  inputTokens + outputTokens,
		})
	}
	return estimates
}

func formatK(tokens int) string {
	return fmt.Sprintf("%.1fK", float64(tokens)/1000)
}
