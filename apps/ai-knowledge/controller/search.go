package controller

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"

	"go-pgvector-gemini/db"
	"go-pgvector-gemini/embedding"
)

type SearchRequest struct {
	Query string `json:"query"`
	Limit int    `json:"limit"`
}

type MatchedSource struct {
	ID            int     `json:"id"`
	Category      string  `json:"category"`
	Title         string  `json:"title"`
	Similarity    float64 `json:"similarity"`
	SimilarityPct string  `json:"similarity_percentage"`
}

type SearchExecutionResult struct {
	Status          string                    `json:"status"`
	Source          string                    `json:"source"`
	CacheHit        bool                      `json:"cache_hit"`
	CacheSimilarity string                    `json:"cache_similarity,omitempty"`
	MatchedHistory  string                    `json:"matched_history,omitempty"`
	Query           string                    `json:"query"`
	Feedback        *embedding.FeedbackResult `json:"feedback"`
	MatchedSources  []MatchedSource           `json:"matched_sources"`
}

// ExecuteSearch performs the embedding, semantic cache lookup, pgvector search, and LLM feedback generation.
func (c *DocumentController) ExecuteSearch(ctx context.Context, queryText string, limit int) (*SearchExecutionResult, error) {
	if limit <= 0 {
		limit = 3
	}

	// 1. Generate Query Vector Embedding menggunakan Gemini
	queryVec, err := c.embedder.GenerateQueryEmbedding(ctx, queryText)
	if err != nil {
		return nil, fmt.Errorf("gagal generate query embedding: %w", err)
	}

	// 2. Cek Semantic Cache (threshold kemiripan >= 0.92)
	const cacheSimilarityThreshold = 0.92
	cachedHit, err := db.FindCachedFeedback(ctx, c.pool, queryVec, cacheSimilarityThreshold)
	if err != nil {
		log.Printf("Peringatan: gagal mencari query cache: %v", err)
	} else if cachedHit != nil {
		_ = db.IncrementCacheHit(ctx, c.pool, cachedHit.ID)
		log.Printf("[CACHE HIT] Query: '%s' cocok dengan riwayat: '%s' (kemiripan: %.2f%%)",
			queryText, cachedHit.QueryText, cachedHit.Similarity*100)

		var fb embedding.FeedbackResult
		if err := json.Unmarshal(cachedHit.Feedback, &fb); err != nil {
			log.Printf("Gagal parse cached feedback: %v", err)
		}

		var sources []MatchedSource
		if len(cachedHit.MatchedSources) > 0 {
			_ = json.Unmarshal(cachedHit.MatchedSources, &sources)
		}

		return &SearchExecutionResult{
			Status:          "success",
			Source:          "cache",
			CacheHit:        true,
			MatchedHistory:  cachedHit.QueryText,
			CacheSimilarity: fmt.Sprintf("%.2f%%", cachedHit.Similarity*100),
			Query:           queryText,
			Feedback:        &fb,
			MatchedSources:  sources,
		}, nil
	}

	// 3. Cache Miss: Cari dokumen dengan skor kemiripan tertinggi di PostgreSQL
	results, err := db.SearchSimilar(ctx, c.pool, queryVec, limit)
	if err != nil {
		return nil, fmt.Errorf("gagal melakukan pencarian vektor di database: %w", err)
	}

	// 4. Konversi dokumen hasil pencarian menjadi konteks referensi AI
	var refContexts []embedding.ReferenceContext
	var matchedSources []MatchedSource
	for _, res := range results {
		refContexts = append(refContexts, embedding.ReferenceContext{
			ID:         res.ID,
			Category:   res.Category,
			Title:      res.Title,
			Content:    res.Content,
			Similarity: res.Similarity,
		})
		matchedSources = append(matchedSources, MatchedSource{
			ID:            res.ID,
			Category:      res.Category,
			Title:         res.Title,
			Similarity:    res.Similarity,
			SimilarityPct: fmt.Sprintf("%.2f%%", res.Similarity*100),
		})
	}

	// 5. Generate AI Feedback responsif (Inisiatif AI: respon cepat & rangkuman)
	aiFeedback, err := c.embedder.GenerateFeedback(ctx, queryText, refContexts)
	if err != nil {
		return nil, fmt.Errorf("gagal memproses feedback AI: %w", err)
	}

	// 6. Simpan pertanyaan, embedding vektor, dan feedback ke semantic cache
	if err := db.InsertQueryCache(ctx, c.pool, queryText, queryVec, aiFeedback, matchedSources); err != nil {
		log.Printf("Peringatan: gagal menyimpan ke query cache: %v", err)
	}

	return &SearchExecutionResult{
		Status:         "success",
		Source:         "generated",
		CacheHit:       false,
		Query:          queryText,
		Feedback:       aiFeedback,
		MatchedSources: matchedSources,
	}, nil
}

func (c *DocumentController) HandleSemanticSearch(w http.ResponseWriter, r *http.Request) {
	var queryText string
	limit := 3

	if r.Method == http.MethodGet {
		queryText = r.URL.Query().Get("q")
		if queryText == "" {
			queryText = r.URL.Query().Get("query")
		}
		if l, err := strconv.Atoi(r.URL.Query().Get("limit")); err == nil && l > 0 {
			limit = l
		}
	} else {
		var req SearchRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			WriteError(w, http.StatusBadRequest, "Invalid JSON body")
			return
		}
		queryText = req.Query
		if req.Limit > 0 {
			limit = req.Limit
		}
	}

	queryText = strings.TrimSpace(queryText)
	if queryText == "" {
		WriteError(w, http.StatusBadRequest, "Query pertanyaan atau keluhan tidak boleh kosong")
		return
	}

	res, err := c.ExecuteSearch(r.Context(), queryText, limit)
	if err != nil {
		log.Printf("Error execute search: %v", err)
		WriteError(w, http.StatusInternalServerError, err.Error())
		return
	}

	WriteJSON(w, http.StatusOK, res)
}
