package embedding

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/pgvector/pgvector-go"
	"google.golang.org/genai"
)

type GeminiEmbedder struct {
	client    *genai.Client
	model     string
	dimension int32
}

// NewGeminiEmbedder creates a new embedder using the official Google GenAI SDK.
func NewGeminiEmbedder(ctx context.Context, apiKey, modelName string) (*GeminiEmbedder, error) {
	if modelName == "" {
		modelName = "gemini-embedding-001"
	}

	client, err := genai.NewClient(ctx, &genai.ClientConfig{
		APIKey:  apiKey,
		Backend: genai.BackendGeminiAPI,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create genai client: %w", err)
	}

	return &GeminiEmbedder{
		client:    client,
		model:     modelName,
		dimension: 768, // Default 768 dimension matching PostgreSQL VECTOR(768)
	}, nil
}

// Close is a no-op placeholder for clean interface lifecycle.
func (e *GeminiEmbedder) Close() {
	// genai.Client uses HTTP standard transport under the hood
}

// GenerateDocumentEmbedding creates an asymmetric vector embedding specifically optimized
// for storing informational documents (RETRIEVAL_DOCUMENT) with explicit title weighting.
func (e *GeminiEmbedder) GenerateDocumentEmbedding(ctx context.Context, title, content string) (pgvector.Vector, error) {
	dim := e.dimension
	res, err := e.client.Models.EmbedContent(ctx, e.model, []*genai.Content{
		{
			Parts: []*genai.Part{
				{Text: content},
			},
		},
	}, &genai.EmbedContentConfig{
		OutputDimensionality: &dim,
		TaskType:             "RETRIEVAL_DOCUMENT",
		Title:                title,
	})
	if err != nil {
		return pgvector.Vector{}, fmt.Errorf("failed to generate document embedding: %w", err)
	}

	if len(res.Embeddings) == 0 || len(res.Embeddings[0].Values) == 0 {
		return pgvector.Vector{}, fmt.Errorf("received empty document embeddings from Gemini")
	}

	return pgvector.NewVector(res.Embeddings[0].Values), nil
}

// GenerateQueryEmbedding creates an asymmetric vector embedding specifically optimized
// for search queries (RETRIEVAL_QUERY) to accurately retrieve relevant documents.
func (e *GeminiEmbedder) GenerateQueryEmbedding(ctx context.Context, query string) (pgvector.Vector, error) {
	dim := e.dimension
	res, err := e.client.Models.EmbedContent(ctx, e.model, []*genai.Content{
		{
			Parts: []*genai.Part{
				{Text: query},
			},
		},
	}, &genai.EmbedContentConfig{
		OutputDimensionality: &dim,
		TaskType:             "RETRIEVAL_QUERY",
	})
	if err != nil {
		return pgvector.Vector{}, fmt.Errorf("failed to generate query embedding: %w", err)
	}

	if len(res.Embeddings) == 0 || len(res.Embeddings[0].Values) == 0 {
		return pgvector.Vector{}, fmt.Errorf("received empty query embeddings from Gemini")
	}

	return pgvector.NewVector(res.Embeddings[0].Values), nil
}

// GenerateEmbedding provides a fallback embedding without specific task type.
func (e *GeminiEmbedder) GenerateEmbedding(ctx context.Context, text string) (pgvector.Vector, error) {
	return e.GenerateQueryEmbedding(ctx, text)
}

// ReferenceContext represents reference document data retrieved from vector search.
type ReferenceContext struct {
	ID         int     `json:"id"`
	Category   string  `json:"category"`
	Title      string  `json:"title"`
	Content    string  `json:"content"`
	Similarity float64 `json:"similarity"`
}

// FeedbackResult represents the structured AI feedback response.
type FeedbackResult struct {
	RelatedService    string  `json:"related_service"`
	Category          string  `json:"category"`
	ShortDescription  string  `json:"short_description"`
	LongSummary       string  `json:"long_summary"`
	BestSimilarity    float64 `json:"best_similarity"`
	BestSimilarityPct string  `json:"best_similarity_percentage"`
}

// GenerateFeedback uses Gemini LLM to generate an actionable AI feedback response
// based on the top vector similarity search matches.
func (e *GeminiEmbedder) GenerateFeedback(ctx context.Context, userQuery string, refs []ReferenceContext) (*FeedbackResult, error) {
	if len(refs) == 0 {
		return &FeedbackResult{
			RelatedService:    "Tidak Ditemukan",
			Category:          "Umum",
			ShortDescription:  "Mohon maaf, kami belum menemukan layanan atau produk yang sesuai dengan keluhan atau pertanyaan Anda.",
			LongSummary:       "Silakan periksa kembali kata kunci pertanyaan atau hubungi petugas layanan pelanggan untuk bantuan lebih lanjut.",
			BestSimilarity:    0,
			BestSimilarityPct: "0.00%",
		}, nil
	}

	best := refs[0]

	// Guardrail: jika similarity terbaik terlalu rendah (< 0.45), jangan paksakan LLM berhalusinasi
	const minSimilarityThreshold = 0.45
	if best.Similarity < minSimilarityThreshold {
		return &FeedbackResult{
			RelatedService:    "Tidak Ditemukan",
			Category:          "Umum",
			ShortDescription:  "Mohon maaf, pertanyaan Anda belum ditemukan kecocokan SOP resminya di pangkalan data internal.",
			LongSummary:       "Silakan ajukan pertanyaan yang lebih spesifik atau hubungi petugas layanan pelanggan untuk bantuan lebih lanjut.",
			BestSimilarity:    best.Similarity,
			BestSimilarityPct: fmt.Sprintf("%.2f%%", best.Similarity*100),
		}, nil
	}

	// Format konteks referensi dokumen
	var contextBuilder strings.Builder
	for i, ref := range refs {
		if i >= 3 {
			break // Ambil maksimal 3 dokumen teratas sebagai konteks
		}
		contextBuilder.WriteString(fmt.Sprintf("\n--- Dokumen #%d ---\nKategori: %s\nJudul: %s\nIsi: %s\nTingkat Kemiripan: %.2f%%\n",
			i+1, ref.Category, ref.Title, ref.Content, ref.Similarity*100))
	}

	prompt := fmt.Sprintf(`Kamu adalah asisten AI customer service dan layanan publik cerdas yang responsif, solutif, dan berempati tinggi.
Tugas utamamu:
Berikan umpan balik / tanggapan membalas pertanyaan atau keluhan pengguna berdasarkan dokumen referensi SOP/layanan yang paling mendekati dan relevan di bawah ini.

Pertanyaan / Keluhan Pengguna:
"%s"

Dokumen Referensi Terkait (Hasil Pencarian Kemiripan Vektor):
%s

Instruksi:
1. "related_service": Sebutkan nama layanan atau produk terkait secara spesifik berdasarkan dokumen referensi terbaik.
2. "category": Kategori dari layanan tersebut.
3. "short_description": Inisiatif respon cepat AI (1-2 kalimat) yang ramah dan solutif, langsung menyebutkan nama produk/layanan terkait untuk menjawab pertanyaan atau keluhan pengguna.
4. "long_summary": Deskripsi panjang yang merangkum solusi lengkap, alur/prosedur yang harus dijalani, syarat berkas yang diperlukan, serta tempat atau pihak yang harus dihubungi berdasarkan dokumen referensi.

Kembalikan HANYA format JSON valid tanpa tanda kutip pembuka/penutup markdown seperti `+"```"+`json:
{
  "related_service": "...",
  "category": "...",
  "short_description": "...",
  "long_summary": "..."
}`, userQuery, contextBuilder.String())

	modelsToTry := []string{"gemini-3.5-flash-lite", "gemini-flash-lite-latest", "gemini-3.8-flash"}
	var resp *genai.GenerateContentResponse
	var err error

	genConfig := &genai.GenerateContentConfig{
		MaxOutputTokens:  400,
		ResponseMIMEType: "application/json",
	}

	for _, model := range modelsToTry {
		for attempt := 1; attempt <= 2; attempt++ {
			resp, err = e.client.Models.GenerateContent(ctx, model, []*genai.Content{
				{
					Parts: []*genai.Part{
						{Text: prompt},
					},
				},
			}, genConfig)
			if err == nil && len(resp.Candidates) > 0 && len(resp.Candidates[0].Content.Parts) > 0 {
				break
			}
			time.Sleep(500 * time.Millisecond)
		}
		if err == nil && len(resp.Candidates) > 0 && len(resp.Candidates[0].Content.Parts) > 0 {
			break
		}
	}

	if err != nil || len(resp.Candidates) == 0 || len(resp.Candidates[0].Content.Parts) == 0 {
		// Fallback cerdas jika terjadi kegagalan pemanggilan LLM
		return &FeedbackResult{
			RelatedService:    best.Title,
			Category:          best.Category,
			ShortDescription:  fmt.Sprintf("Terkait pertanyaan atau keluhan Anda, layanan yang relevan adalah '%s'.", best.Title),
			LongSummary:       best.Content,
			BestSimilarity:    best.Similarity,
			BestSimilarityPct: fmt.Sprintf("%.2f%%", best.Similarity*100),
		}, nil
	}

	rawText := resp.Candidates[0].Content.Parts[0].Text
	cleanJSON := strings.TrimSpace(rawText)
	cleanJSON = strings.TrimPrefix(cleanJSON, "```json")
	cleanJSON = strings.TrimPrefix(cleanJSON, "```")
	cleanJSON = strings.TrimSuffix(cleanJSON, "```")
	cleanJSON = strings.TrimSpace(cleanJSON)

	var result FeedbackResult
	if err := json.Unmarshal([]byte(cleanJSON), &result); err != nil {
		// Fallback jika parse JSON tidak sesuai
		result.RelatedService = best.Title
		result.Category = best.Category
		result.ShortDescription = fmt.Sprintf("Berdasarkan keluhan Anda, layanan yang paling tepat adalah '%s'.", best.Title)
		result.LongSummary = rawText
	}

	result.BestSimilarity = best.Similarity
	result.BestSimilarityPct = fmt.Sprintf("%.2f%%", best.Similarity*100)

	return &result, nil
}

