package preview

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestResolveLatestReport(t *testing.T) {
	root := t.TempDir()
	configPath := filepath.Join(root, "config.txt")
	reportPath := filepath.Join(root, "runs", "run_1", "RESULTS.md")
	if err := os.MkdirAll(filepath.Dir(reportPath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(reportPath, []byte("# Report"), 0o600); err != nil {
		t.Fatal(err)
	}
	resolved, err := Resolve("latest", configPath)
	if err != nil {
		t.Fatal(err)
	}
	if resolved != reportPath {
		t.Fatalf("resolved %q, want %q", resolved, reportPath)
	}
}

func TestReportHandlerSecurityHeaders(t *testing.T) {
	handler := reportHandler([]byte("<html>ok</html>"))
	request := httptest.NewRequest(http.MethodGet, "/report", nil)
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("unexpected status: %d", recorder.Code)
	}
	if !strings.Contains(recorder.Header().Get("Content-Security-Policy"), "default-src 'none'") {
		t.Fatal("missing CSP header")
	}
}
