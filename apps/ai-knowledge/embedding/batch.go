package embedding

import (
	"context"
	"errors"
	"fmt"
	"time"

	"google.golang.org/genai"
)

// embedBatchMax is how many texts go into one EmbedContent call; the Gemini
// API refuses larger batches.
const embedBatchMax = 100

// RateLimitedError is Gemini answering 429, with how long it asked us to wait.
// Every text in a batch counts against the per-minute quota on its own, so a
// large menu can hit it even in a single call.
type RateLimitedError struct {
	Wait time.Duration
	Err  error
}

func (e *RateLimitedError) Error() string             { return e.Err.Error() }
func (e *RateLimitedError) Unwrap() error             { return e.Err }
func (e *RateLimitedError) RetryAfter() time.Duration { return e.Wait }

// asRateLimited marks a 429 so callers can wait and try again. Other errors
// pass through unchanged.
func asRateLimited(err error) error {
	var api genai.APIError
	if !errors.As(err, &api) || api.Code != 429 {
		return err
	}
	wait := 30 * time.Second
	for _, d := range api.Details {
		if s, ok := d["retryDelay"].(string); ok {
			if w, perr := time.ParseDuration(s); perr == nil && w > 0 {
				wait = w
			}
		}
	}
	return &RateLimitedError{Wait: wait, Err: err}
}

// EmbedDocuments embeds many texts as documents in as few calls as the API
// allows, so a menu of a hundred-odd destinations costs two requests instead
// of a hundred. The result is in the same order as texts.
func (e *GeminiEmbedder) EmbedDocuments(ctx context.Context, texts []string) ([][]float32, error) {
	return e.embedMany(ctx, texts, "RETRIEVAL_DOCUMENT")
}

// EmbedQueries embeds many texts the way a question is embedded. A question
// compared with another question must be embedded alike: as query against
// document, two identical sentences score only about 0.86.
func (e *GeminiEmbedder) EmbedQueries(ctx context.Context, texts []string) ([][]float32, error) {
	return e.embedMany(ctx, texts, "RETRIEVAL_QUERY")
}

func (e *GeminiEmbedder) embedMany(ctx context.Context, texts []string, taskType string) ([][]float32, error) {
	dim := e.dimension
	out := make([][]float32, 0, len(texts))
	for start := 0; start < len(texts); start += embedBatchMax {
		end := min(start+embedBatchMax, len(texts))
		contents := make([]*genai.Content, 0, end-start)
		for _, t := range texts[start:end] {
			contents = append(contents, &genai.Content{Parts: []*genai.Part{{Text: t}}})
		}

		res, err := e.client.Models.EmbedContent(ctx, e.model, contents, &genai.EmbedContentConfig{
			OutputDimensionality: &dim,
			TaskType:             taskType,
		})
		if err != nil {
			return nil, asRateLimited(fmt.Errorf("failed to embed %d-%d as %s: %w", start, end, taskType, err))
		}
		if len(res.Embeddings) != end-start {
			return nil, fmt.Errorf("expected %d embeddings from Gemini, got %d", end-start, len(res.Embeddings))
		}
		for _, emb := range res.Embeddings {
			if emb == nil || len(emb.Values) == 0 {
				return nil, fmt.Errorf("received an empty document embedding from Gemini")
			}
			out = append(out, emb.Values)
		}
	}
	return out, nil
}

// EmbedQuery embeds one question as plain floats.
func (e *GeminiEmbedder) EmbedQuery(ctx context.Context, text string) ([]float32, error) {
	vec, err := e.GenerateQueryEmbedding(ctx, text)
	if err != nil {
		return nil, asRateLimited(err)
	}
	return vec.Slice(), nil
}
