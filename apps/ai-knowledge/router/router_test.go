package router

import (
	"context"
	"errors"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// fakeEmbedder turns a text into keyword counts, so similarity is easy to
// reason about: texts sharing a keyword point the same way.
type fakeEmbedder struct {
	docCalls  atomic.Int32
	failNext  atomic.Bool
	limitNext atomic.Bool
	delay     time.Duration
}

// quota is a 429 that asks for a very short wait.
type quota struct{}

func (quota) Error() string             { return "429 quota" }
func (quota) RetryAfter() time.Duration { return 10 * time.Millisecond }

// memStore stands in for the route_embeddings table.
type memStore struct {
	mu   sync.Mutex
	rows map[string][]float32
}

func (s *memStore) Load(_ context.Context, keys []string) (map[string][]float32, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := map[string][]float32{}
	for _, k := range keys {
		if v, ok := s.rows[k]; ok {
			out[k] = v
		}
	}
	return out, nil
}

func (s *memStore) Save(_ context.Context, items map[string][]float32) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.rows == nil {
		s.rows = map[string][]float32{}
	}
	for k, v := range items {
		s.rows[k] = v
	}
	return nil
}

var vocab = []string{"skck", "paspor", "pajak", "gadai", "emas"}

func vec(text string) []float32 {
	v := make([]float32, len(vocab))
	for i, w := range vocab {
		v[i] = float32(strings.Count(strings.ToLower(text), w))
	}
	return v
}

func (f *fakeEmbedder) EmbedDocuments(_ context.Context, texts []string) ([][]float32, error) {
	f.docCalls.Add(1)
	time.Sleep(f.delay)
	if f.failNext.CompareAndSwap(true, false) {
		return nil, errors.New("gemini down")
	}
	if f.limitNext.CompareAndSwap(true, false) {
		return nil, quota{}
	}
	out := make([][]float32, len(texts))
	for i, t := range texts {
		out[i] = vec(t)
	}
	return out, nil
}

func (f *fakeEmbedder) EmbedQuery(_ context.Context, text string) ([]float32, error) {
	return vec(text), nil
}

func (f *fakeEmbedder) EmbedQueries(_ context.Context, texts []string) ([][]float32, error) {
	out := make([][]float32, len(texts))
	for i, t := range texts {
		out[i] = vec(t)
	}
	return out, nil
}

var menu = []Destination{
	{ID: "mp_polres", Path: "Layanan Publik › Polres Cimahi (SKCK)", Content: "Pelayanan SKCK di MPP"},
	{ID: "mp_imigrasi", Path: "Layanan Publik › Imigrasi", Content: "Perpanjang paspor"},
	{ID: "mp_samsat", Path: "Layanan Publik › Samsat", Content: "Bayar pajak kendaraan"},
}

func route(t *testing.T, r *Router, q string, dests []Destination) *Result {
	t.Helper()
	res, err := r.Route(context.Background(), q, dests, nil)
	if err != nil {
		t.Fatalf("Route(%q): %v", q, err)
	}
	return res
}

func TestRoutePicksClosestAndListsCandidates(t *testing.T) {
	r := New(&fakeEmbedder{}, nil, Config{MinScore: 0.5, MinMargin: 0.02})
	res := route(t, r, "Gimana bikin SKCK?", menu)

	if res.DestinationID == nil || *res.DestinationID != "mp_polres" {
		t.Fatalf("destination = %v, want mp_polres", res.DestinationID)
	}
	if res.Score < 0.99 {
		t.Errorf("score = %v, want ~1", res.Score)
	}
	if len(res.Candidates) != 3 || res.Candidates[0].ID != "mp_polres" || res.Candidates[0].Score < res.Candidates[1].Score {
		t.Errorf("candidates not best-first: %+v", res.Candidates)
	}
}

func TestRouteBelowMinScoreReportsScoreButPicksNothing(t *testing.T) {
	r := New(&fakeEmbedder{}, nil, Config{MinScore: 0.5})
	res := route(t, r, "harga cabai hari ini", menu)

	if res.DestinationID != nil {
		t.Fatalf("destination = %q, want null", *res.DestinationID)
	}
	if res.Candidates == nil {
		t.Error("candidates must be an empty list, not null")
	}
}

func TestRouteTornBetweenMenusIsNullButNotWithinOneMenu(t *testing.T) {
	tied := []Destination{
		{ID: "a", Path: "Layanan Publik › Pegadaian", Content: "gadai emas"},
		{ID: "b", Path: "Investasi › Emas", Content: "gadai emas"},
	}
	r := New(&fakeEmbedder{}, nil, Config{MinScore: 0.5, MinMargin: 0.05})
	if res := route(t, r, "gadai emas", tied); res.DestinationID != nil {
		t.Errorf("two menus tied: destination = %q, want null", *res.DestinationID)
	}

	tied[1].Path = "Layanan Publik › Pegadaian › Gadai Emas"
	if res := route(t, r, "gadai emas", tied); res.DestinationID == nil {
		t.Error("tied within one menu: want a pick, got null")
	}
}

func TestMenuIsEmbeddedOnceAndAgainWhenItChanges(t *testing.T) {
	emb := &fakeEmbedder{}
	r := New(emb, nil, Config{MinScore: 0.5})

	route(t, r, "skck", menu)
	route(t, r, "paspor", menu)
	if n := emb.docCalls.Load(); n != 1 {
		t.Fatalf("same menu embedded %d times, want 1", n)
	}

	changed := append([]Destination(nil), menu...)
	changed[2].Content = "Bayar pajak motor"
	route(t, r, "pajak", changed)
	if n := emb.docCalls.Load(); n != 2 {
		t.Fatalf("changed menu: %d embeddings, want 2", n)
	}
}

func TestFailedMenuBuildIsRetriedOnNextQuestion(t *testing.T) {
	emb := &fakeEmbedder{}
	emb.failNext.Store(true)
	r := New(emb, nil, Config{MinScore: 0.5})

	if _, err := r.Route(context.Background(), "skck", menu, nil); err == nil {
		t.Fatal("want an error while Gemini is down")
	}
	if res := route(t, r, "skck", menu); res.DestinationID == nil {
		t.Fatal("second try should succeed")
	}
}

func TestRateLimitIsWaitedOut(t *testing.T) {
	emb := &fakeEmbedder{}
	emb.limitNext.Store(true)
	r := New(emb, nil, Config{MinScore: 0.5})

	if res := route(t, r, "skck", menu); res.DestinationID == nil {
		t.Fatal("want a pick once the quota frees up")
	}
	if n := emb.docCalls.Load(); n != 2 {
		t.Fatalf("%d embedding calls, want 2 (one refused, one retried)", n)
	}
}

func TestStoredEmbeddingsSurviveRestart(t *testing.T) {
	store := &memStore{}
	first := &fakeEmbedder{}
	route(t, New(first, store, Config{MinScore: 0.5}), "skck", menu)

	again := &fakeEmbedder{}
	route(t, New(again, store, Config{MinScore: 0.5}), "skck", menu)
	if n := again.docCalls.Load(); n != 0 {
		t.Fatalf("after restart the menu was embedded %d times, want 0", n)
	}

	// Another model must not reuse those vectors.
	other := &fakeEmbedder{}
	route(t, New(other, store, Config{MinScore: 0.5, Namespace: "model-lain"}), "skck", menu)
	if n := other.docCalls.Load(); n != 1 {
		t.Fatalf("new namespace embedded %d times, want 1", n)
	}
}

func TestSlowMenuAnswersNotReadyThenServes(t *testing.T) {
	old := readyWait
	readyWait = 20 * time.Millisecond
	defer func() { readyWait = old }()

	emb := &fakeEmbedder{delay: 150 * time.Millisecond}
	r := New(emb, nil, Config{MinScore: 0.5})

	if _, err := r.Route(context.Background(), "skck", menu, nil); !errors.Is(err, ErrNotReady) {
		t.Fatalf("err = %v, want ErrNotReady", err)
	}
	time.Sleep(250 * time.Millisecond)
	if res := route(t, r, "skck", menu); res.DestinationID == nil {
		t.Fatal("menu should be ready by now")
	}
	if n := emb.docCalls.Load(); n != 1 {
		t.Fatalf("menu embedded %d times, want 1", n)
	}
}

func TestSmallTalkIsNullWithoutSpendingQuota(t *testing.T) {
	emb := &fakeEmbedder{}
	r := New(emb, nil, Config{MinScore: 0.5})
	for _, q := range []string{"Terima kasih banyak min 🙏", "ok", "👍", "Selamat pagi!"} {
		if res := route(t, r, q, menu); res.DestinationID != nil {
			t.Errorf("%q: destination = %q, want null", q, *res.DestinationID)
		}
	}
	if n := emb.docCalls.Load(); n != 0 {
		t.Errorf("small talk embedded the menu %d times, want 0", n)
	}
	if res := route(t, r, "halo, mau bikin skck", menu); res.DestinationID == nil {
		t.Error("a greeting followed by a question must still be routed")
	}
}

type fakeChooser struct {
	answer string
	err    error
	calls  atomic.Int32
	prompt string
}

func (c *fakeChooser) Generate(_ context.Context, prompt string) (string, error) {
	c.calls.Add(1)
	c.prompt = prompt
	return c.answer, c.err
}

// gadaiMenu is the case embeddings get wrong: "emas" pulls the question to
// Cicil Emas, while it is about pawning.
var gadaiMenu = []Destination{
	{ID: "pd_kca", Path: "Layanan Publik › Pegadaian › KCA", Content: "pinjaman sistem gadai"},
	{ID: "pd_cicil", Path: "Layanan Publik › Pegadaian › Cicil Emas", Content: "emas emas emas"},
}

func TestChooserCanOverrulePlainSimilarity(t *testing.T) {
	plain := route(t, New(&fakeEmbedder{}, nil, Config{MinScore: 0.1}), "mau gadai emas", gadaiMenu)
	if plain.DestinationID == nil || *plain.DestinationID != "pd_cicil" {
		t.Fatalf("setup: embeddings alone should pick pd_cicil, got %v", plain.DestinationID)
	}

	chooser := &fakeChooser{answer: "```json\n{\"id\": \"pd_kca\"}\n```"}
	res := route(t, New(&fakeEmbedder{}, nil, Config{MinScore: 0.1, Chooser: chooser}), "mau gadai emas", gadaiMenu)
	if res.DestinationID == nil || *res.DestinationID != "pd_kca" {
		t.Fatalf("destination = %v, want pd_kca", res.DestinationID)
	}
	// pd_kca is less similar than pd_cicil, but the chooser decided. Its own
	// similarity would let claudewa, applying the same bar, overrule that.
	if res.Score != plain.Score {
		t.Errorf("score = %v, want the closest destination's %v", res.Score, plain.Score)
	}
}

func TestChooserNullMeansNoJump(t *testing.T) {
	r := New(&fakeEmbedder{}, nil, Config{MinScore: 0.1, Chooser: &fakeChooser{answer: `{"id": null}`}})
	if res := route(t, r, "gadai emas", gadaiMenu); res.DestinationID != nil {
		t.Fatalf("destination = %q, want null", *res.DestinationID)
	}
}

func TestChooserTroubleFallsBackToEmbeddings(t *testing.T) {
	for name, c := range map[string]*fakeChooser{
		"error":        {err: errors.New("timeout")},
		"not json":     {answer: "pd_kca"},
		"unknown id":   {answer: `{"id": "kantor_lain"}`},
		"id not shown": {answer: `{"id": "mp_polres"}`},
	} {
		r := New(&fakeEmbedder{}, nil, Config{MinScore: 0.1, Chooser: c})
		res := route(t, r, "mau gadai emas", gadaiMenu)
		if res.DestinationID == nil || *res.DestinationID != "pd_cicil" {
			t.Errorf("%s: destination = %v, want the embedding pick pd_cicil", name, res.DestinationID)
		}
	}
}

func TestChooserNotAskedBelowMinScore(t *testing.T) {
	c := &fakeChooser{answer: `{"id": "mp_polres"}`}
	r := New(&fakeEmbedder{}, nil, Config{MinScore: 0.5, Chooser: c})
	if res := route(t, r, "harga cabai", menu); res.DestinationID != nil {
		t.Fatalf("destination = %q, want null", *res.DestinationID)
	}
	if n := c.calls.Load(); n != 0 {
		t.Errorf("chooser asked %d times for an unrelated question, want 0", n)
	}
}

func TestValidate(t *testing.T) {
	cases := []struct {
		name  string
		q     string
		dests []Destination
		ok    bool
	}{
		{"valid", "skck", menu, true},
		{"empty question", "", menu, false},
		{"no destinations", "skck", nil, false},
		{"missing id", "skck", []Destination{{Path: "A"}}, false},
		{"duplicate id", "skck", []Destination{{ID: "a"}, {ID: "a"}}, false},
	}
	for _, c := range cases {
		if err := Validate(c.q, c.dests); (err == nil) != c.ok {
			t.Errorf("%s: err = %v", c.name, err)
		}
	}
}

func TestNormalizeKeepsPunctuation(t *testing.T) {
	got := Normalize("Gimana  BIKIN skck?")
	want := "bagaimana buat skck surat keterangan catatan kepolisian?"
	if got != want {
		t.Errorf("Normalize = %q, want %q", got, want)
	}
}

// routeWith is route with approved examples.
func routeWith(t *testing.T, r *Router, q string, dests []Destination, examples []Example) *Result {
	t.Helper()
	res, err := r.Route(context.Background(), q, dests, examples)
	if err != nil {
		t.Fatalf("Route(%q): %v", q, err)
	}
	return res
}

func TestExampleNearlyTheSameJumpsStraightThere(t *testing.T) {
	examples := []Example{{DestinationID: "pd_kca", Question: "Mau gadai emas"}}
	r := New(&fakeEmbedder{}, nil, Config{MinScore: 0.1, ExampleMin: 0.9})

	res := routeWith(t, r, "mau gadai emas", gadaiMenu, examples)

	if res.DestinationID == nil || *res.DestinationID != "pd_kca" {
		t.Fatalf("destination = %v, want pd_kca from the example", res.DestinationID)
	}
	if res.Via != "contoh" || res.Score < 0.9 {
		t.Errorf("via %q, score %v; want contoh at or above 0.9", res.Via, res.Score)
	}
}

func TestExamplesForDestinationsNotSentAreIgnored(t *testing.T) {
	examples := []Example{{DestinationID: "kantor_lain", Question: "mau gadai emas"}, {DestinationID: "pd_kca"}}
	r := New(&fakeEmbedder{}, nil, Config{MinScore: 0.1, ExampleMin: 0.9})

	res := routeWith(t, r, "mau gadai emas", gadaiMenu, examples)

	if res.DestinationID == nil || *res.DestinationID != "pd_cicil" || res.Via == "contoh" {
		t.Fatalf("destination = %v via %q, want the plain embedding pick pd_cicil", res.DestinationID, res.Via)
	}
}

func TestExamplesThatDisagreeDoNotJump(t *testing.T) {
	examples := []Example{
		{DestinationID: "pd_kca", Question: "gadai emas"},
		{DestinationID: "pd_cicil", Question: "gadai emas"},
	}
	r := New(&fakeEmbedder{}, nil, Config{MinScore: 0.1, MinMargin: 0.02, ExampleMin: 0.9})

	if res := routeWith(t, r, "gadai emas", gadaiMenu, examples); res.Via == "contoh" {
		t.Fatalf("jumped to %v on two equally close examples", *res.DestinationID)
	}
}

func TestLooseExampleOnlyHelpsTheChooser(t *testing.T) {
	// "gadai" alone is about 0.71 from "gadai emas": a hint, not a match.
	examples := []Example{{DestinationID: "pd_kca", Question: "gadai"}}

	c := &fakeChooser{answer: `{"id": "pd_kca"}`}
	res := routeWith(t, New(&fakeEmbedder{}, nil, Config{MinScore: 0.1, ExampleMin: 0.9, Chooser: c}), "gadai emas", gadaiMenu, examples)
	if res.Via != "pemilih AI" || *res.DestinationID != "pd_kca" {
		t.Fatalf("destination = %v via %q, want the chooser's pd_kca", res.DestinationID, res.Via)
	}
	if !strings.Contains(c.prompt, `contoh pertanyaan warga: "gadai"`) || !strings.Contains(c.prompt, "5. Contoh pertanyaan") {
		t.Errorf("the chooser was not shown the example:\n%s", c.prompt)
	}

	plain := routeWith(t, New(&fakeEmbedder{}, nil, Config{MinScore: 0.1, ExampleMin: 0.9}), "gadai emas", gadaiMenu, examples)
	if plain.DestinationID == nil || *plain.DestinationID != "pd_cicil" {
		t.Errorf("without the chooser destination = %v, want the menu's own pick pd_cicil", plain.DestinationID)
	}
}

func TestChooserPromptWithoutExamplesIsUnchanged(t *testing.T) {
	c := &fakeChooser{answer: `{"id": "pd_kca"}`}
	routeWith(t, New(&fakeEmbedder{}, nil, Config{MinScore: 0.1, Chooser: c}), "gadai emas", gadaiMenu, nil)
	if strings.Contains(c.prompt, "contoh") {
		t.Errorf("prompt mentions examples although none were sent:\n%s", c.prompt)
	}
}

// blankMenu has no word the fake embedder knows, so it scores 0 against any
// question: only examples can get a question past the bar.
var blankMenu = []Destination{
	{ID: "a", Path: "Kantor A", Content: "layanan umum"},
	{ID: "b", Path: "Kantor B", Content: "layanan lain"},
}

func TestExamplesCanLiftAQuestionPastTheBar(t *testing.T) {
	examples := []Example{{DestinationID: "a", Question: "skck"}}

	c := &fakeChooser{answer: `{"id": "a"}`}
	r := New(&fakeEmbedder{}, nil, Config{MinScore: 0.5, ExampleMin: 0.99, Chooser: c})
	res := routeWith(t, r, "skck paspor", blankMenu, examples)
	if res.DestinationID == nil || *res.DestinationID != "a" {
		t.Fatalf("destination = %v, want a", res.DestinationID)
	}

	// Without the chooser the menu text alone decides, and it knows nothing.
	failing := New(&fakeEmbedder{}, nil, Config{MinScore: 0.5, ExampleMin: 0.99, Chooser: &fakeChooser{err: errors.New("timeout")}})
	if res := routeWith(t, failing, "skck paspor", blankMenu, examples); res.DestinationID != nil {
		t.Fatalf("destination = %q, want null when only an example cleared the bar", *res.DestinationID)
	}
}

// exampleTrouble fails every batch holding the marked example.
type exampleTrouble struct {
	fakeEmbedder
}

func (e *exampleTrouble) EmbedQueries(ctx context.Context, texts []string) ([][]float32, error) {
	for _, t := range texts {
		if strings.Contains(t, "rusak") {
			return nil, errors.New("gemini down")
		}
	}
	return e.fakeEmbedder.EmbedQueries(ctx, texts)
}

func TestExamplesThatCannotBeEmbeddedAreLeftOut(t *testing.T) {
	examples := []Example{{DestinationID: "pd_kca", Question: "mau gadai emas rusak"}}
	r := New(&exampleTrouble{}, nil, Config{MinScore: 0.1, ExampleMin: 0.5})

	res := routeWith(t, r, "mau gadai emas", gadaiMenu, examples)

	if res.Via == "contoh" || res.DestinationID == nil || *res.DestinationID != "pd_cicil" {
		t.Fatalf("destination = %v via %q, want an answer without the example", res.DestinationID, res.Via)
	}
}

func TestValidateExamples(t *testing.T) {
	if err := ValidateExamples(make([]Example, MaxExamples)); err != nil {
		t.Errorf("%d examples: %v", MaxExamples, err)
	}
	if err := ValidateExamples(make([]Example, MaxExamples+1)); err == nil {
		t.Error("too many examples accepted")
	}
}

func TestExamplesBelowTheHintAreIgnored(t *testing.T) {
	// "skck" against "skck paspor" is about 0.71: under a 0.8 hint it must
	// neither lift the question past the bar nor reach the chooser's prompt.
	examples := []Example{{DestinationID: "a", Question: "skck"}}
	c := &fakeChooser{answer: `{"id": "a"}`}
	r := New(&fakeEmbedder{}, nil, Config{MinScore: 0.5, ExampleMin: 0.99, ExampleHint: 0.8, Chooser: c})

	res := routeWith(t, r, "skck paspor", blankMenu, examples)

	if res.DestinationID != nil || res.Via != "skor rendah" {
		t.Fatalf("destination = %v via %q, want null on a low score", res.DestinationID, res.Via)
	}
	if n := c.calls.Load(); n != 0 {
		t.Errorf("chooser asked %d times, want 0", n)
	}
}

func TestExamplesAndMenuNeverShareACacheRow(t *testing.T) {
	r := New(&fakeEmbedder{}, nil, Config{})
	if r.textKey("skck", true) == r.textKey("skck", false) {
		t.Error("the same text embedded as a query and as a document got one key")
	}
}
