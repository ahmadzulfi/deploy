package embedding

import (
	"context"
	"errors"

	"google.golang.org/genai"
)

// Chooser asks a small Gemini text model to pick between options. It writes
// no prose: the router only needs an id back, so thinking is kept minimal
// and output short to stay inside the router's few-second budget.
type Chooser struct {
	client *genai.Client
	model  string
}

func (e *GeminiEmbedder) Chooser(model string) *Chooser {
	return &Chooser{client: e.client, model: model}
}

func (c *Chooser) Generate(ctx context.Context, prompt string) (string, error) {
	temperature := float32(0)
	res, err := c.client.Models.GenerateContent(ctx, c.model, []*genai.Content{
		{Parts: []*genai.Part{{Text: prompt}}},
	}, &genai.GenerateContentConfig{
		Temperature:      &temperature,
		MaxOutputTokens:  64,
		ResponseMIMEType: "application/json",
		// Newer models refuse a thinking budget of 0; MINIMAL is their off.
		ThinkingConfig: &genai.ThinkingConfig{ThinkingLevel: genai.ThinkingLevelMinimal},
	})
	if err != nil {
		return "", asRateLimited(err)
	}
	text := res.Text()
	if text == "" {
		return "", errors.New("Gemini returned an empty choice")
	}
	return text, nil
}
