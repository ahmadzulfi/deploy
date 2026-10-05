package db

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/pgvector/pgvector-go"
	pgxvec "github.com/pgvector/pgvector-go/pgx"
)

type QueryCacheHit struct {
	ID             int             `json:"id"`
	QueryText      string          `json:"query_text"`
	Feedback       json.RawMessage `json:"feedback"`
	MatchedSources json.RawMessage `json:"matched_sources"`
	Similarity     float64         `json:"similarity"`
	HitCount       int             `json:"hit_count"`
}


type Document struct {
	ID        int
	Category  string
	Title     string
	Content   string
	Embedding pgvector.Vector
	CreatedAt time.Time
}

type SearchResult struct {
	ID         int     `json:"id"`
	Category   string  `json:"category"`
	Title      string  `json:"title"`
	Content    string  `json:"content"`
	Similarity float64 `json:"similarity"`
}

// DocumentResponse represents document data without the raw vector for JSON responses.
type DocumentResponse struct {
	ID        int       `json:"id"`
	Category  string    `json:"category"`
	Title     string    `json:"title"`
	Content   string    `json:"content"`
	CreatedAt time.Time `json:"created_at"`
}

// HasPgVector indicates if the PostgreSQL server supports the pgvector C extension.
var HasPgVector bool

// EnsureDatabaseAndExtension ensures the database and vector search capabilities exist.
func EnsureDatabaseAndExtension(ctx context.Context, connStr string) error {
	config, err := pgxpool.ParseConfig(connStr)
	if err != nil {
		return fmt.Errorf("unable to parse db config: %w", err)
	}

	targetDB := config.ConnConfig.Database
	if targetDB != "" && targetDB != "postgres" {
		adminConfig := config.Copy()
		adminConfig.ConnConfig.Database = "postgres"
		adminPool, err := pgxpool.NewWithConfig(ctx, adminConfig)
		if err == nil {
			var exists bool
			checkQuery := "SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = $1);"
			if err := adminPool.QueryRow(ctx, checkQuery, targetDB).Scan(&exists); err == nil && !exists {
				createQuery := fmt.Sprintf(`CREATE DATABASE "%s";`, targetDB)
				_, _ = adminPool.Exec(ctx, createQuery)
				fmt.Printf(" Database '%s' berhasil dibuat.\n", targetDB)
			}
			adminPool.Close()
		}
	}

	rawConn, err := pgx.Connect(ctx, connStr)
	if err != nil {
		return fmt.Errorf("failed connecting to target db: %w", err)
	}
	defer rawConn.Close(ctx)

	// Cek apakah ekstensi vector tersedia di host PostgreSQL
	if _, err := rawConn.Exec(ctx, "CREATE EXTENSION IF NOT EXISTS vector;"); err == nil {
		HasPgVector = true
		fmt.Println(" Mode Aktif: pgvector Extension (HNSW Indexing)")
	} else {
		HasPgVector = false
		fmt.Println(" Mode Aktif: Native PostgreSQL Float Array + Cosine Similarity Function")
		funcQuery := `
CREATE OR REPLACE FUNCTION cosine_similarity(a double precision[], b double precision[])
RETURNS double precision AS $$
DECLARE
    dot_product double precision := 0;
    norm_a double precision := 0;
    norm_b double precision := 0;
    i int;
    len int := array_length(a, 1);
BEGIN
    FOR i IN 1..len LOOP
        dot_product := dot_product + a[i] * b[i];
        norm_a := norm_a + a[i] * a[i];
        norm_b := norm_b + b[i] * b[i];
    END LOOP;
    IF norm_a = 0 OR norm_b = 0 THEN
        RETURN 0;
    END IF;
    RETURN dot_product / (sqrt(norm_a) * sqrt(norm_b));
END;
$$ LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE;`
		if _, err := rawConn.Exec(ctx, funcQuery); err != nil {
			return fmt.Errorf("failed creating fallback cosine_similarity function: %w", err)
		}
	}

	return nil
}

// Connect establishes a connection pool to PostgreSQL.
func Connect(ctx context.Context, connStr string) (*pgxpool.Pool, error) {
	if err := EnsureDatabaseAndExtension(ctx, connStr); err != nil {
		return nil, fmt.Errorf("ensure database & extension error: %w", err)
	}

	config, err := pgxpool.ParseConfig(connStr)
	if err != nil {
		return nil, fmt.Errorf("unable to parse database config: %w", err)
	}

	if HasPgVector {
		config.AfterConnect = func(ctx context.Context, conn *pgx.Conn) error {
			return pgxvec.RegisterTypes(ctx, conn)
		}
	}

	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		return nil, fmt.Errorf("unable to create connection pool: %w", err)
	}

	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("unable to ping database: %w", err)
	}

	return pool, nil
}

// InitSchema ensures the "docs-gemini-001" and query_cache tables exist.
func InitSchema(ctx context.Context, pool *pgxpool.Pool) error {
	var queries []string
	if HasPgVector {
		queries = []string{
			`CREATE TABLE IF NOT EXISTS "docs-gemini-001" (
				id SERIAL PRIMARY KEY,
				category VARCHAR(100) NOT NULL DEFAULT 'Umum',
				title VARCHAR(255) NOT NULL,
				content TEXT NOT NULL,
				embedding VECTOR(768) NOT NULL,
				created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
			);`,
			`CREATE INDEX IF NOT EXISTS "docs-gemini-001_embedding_idx" ON "docs-gemini-001" USING hnsw (embedding vector_cosine_ops);`,
			`CREATE TABLE IF NOT EXISTS query_cache (
				id SERIAL PRIMARY KEY,
				query_text TEXT NOT NULL,
				query_embedding VECTOR(768) NOT NULL,
				feedback JSONB NOT NULL,
				matched_sources JSONB DEFAULT '[]'::jsonb,
				hit_count INT DEFAULT 1,
				created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
				updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
			);`,
			`CREATE INDEX IF NOT EXISTS query_cache_embedding_idx ON query_cache USING hnsw (query_embedding vector_cosine_ops);`,
		}
	} else {
		queries = []string{
			`CREATE TABLE IF NOT EXISTS "docs-gemini-001" (
				id SERIAL PRIMARY KEY,
				category VARCHAR(100) NOT NULL DEFAULT 'Umum',
				title VARCHAR(255) NOT NULL,
				content TEXT NOT NULL,
				embedding DOUBLE PRECISION[] NOT NULL,
				created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
			);`,
			`CREATE TABLE IF NOT EXISTS query_cache (
				id SERIAL PRIMARY KEY,
				query_text TEXT NOT NULL,
				query_embedding DOUBLE PRECISION[] NOT NULL,
				feedback JSONB NOT NULL,
				matched_sources JSONB DEFAULT '[]'::jsonb,
				hit_count INT DEFAULT 1,
				created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
				updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
			);`,
		}
	}

	for _, query := range queries {
		if _, err := pool.Exec(ctx, query); err != nil {
			return fmt.Errorf("failed executing schema query (%s): %w", query, err)
		}
	}

	return nil
}

// ResetDatabase drops the table and recreates clean schema with ID starting from 1.
func ResetDatabase(ctx context.Context, pool *pgxpool.Pool) error {
	queries := []string{
		`DROP TABLE IF EXISTS "docs-gemini-001" CASCADE;`,
		`DROP TABLE IF EXISTS documents CASCADE;`,
		`DROP TABLE IF EXISTS query_cache CASCADE;`,
	}

	for _, query := range queries {
		if _, err := pool.Exec(ctx, query); err != nil {
			return fmt.Errorf("failed executing drop query (%s): %w", query, err)
		}
	}

	return InitSchema(ctx, pool)
}

// InsertDocument saves a document along with its category and 768-dim vector embedding into "docs-gemini-001".
func InsertDocument(ctx context.Context, pool *pgxpool.Pool, category, title, content string, embedding pgvector.Vector) (int, error) {
	if category == "" {
		category = "Umum"
	}

	var id int
	if HasPgVector {
		query := `
			INSERT INTO "docs-gemini-001" (category, title, content, embedding)
			VALUES ($1, $2, $3, $4)
			RETURNING id;
		`
		err := pool.QueryRow(ctx, query, category, title, content, embedding).Scan(&id)
		if err != nil {
			return 0, fmt.Errorf("failed to insert document: %w", err)
		}
	} else {
		f32s := embedding.Slice()
		f64s := make([]float64, len(f32s))
		for i, v := range f32s {
			f64s[i] = float64(v)
		}
		query := `
			INSERT INTO "docs-gemini-001" (category, title, content, embedding)
			VALUES ($1, $2, $3, $4)
			RETURNING id;
		`
		err := pool.QueryRow(ctx, query, category, title, content, f64s).Scan(&id)
		if err != nil {
			return 0, fmt.Errorf("failed to insert document: %w", err)
		}
	}
	return id, nil
}

// SearchSimilar finds top K most similar documents in "docs-gemini-001" using cosine similarity.
func SearchSimilar(ctx context.Context, pool *pgxpool.Pool, queryVec pgvector.Vector, limit int) ([]SearchResult, error) {
	var rows pgx.Rows
	var err error

	if HasPgVector {
		query := `
			SELECT id, category, title, content, 1 - (embedding <=> $1) AS similarity
			FROM "docs-gemini-001"
			ORDER BY embedding <=> $1 ASC
			LIMIT $2;
		`
		rows, err = pool.Query(ctx, query, queryVec, limit)
	} else {
		f32s := queryVec.Slice()
		f64s := make([]float64, len(f32s))
		for i, v := range f32s {
			f64s[i] = float64(v)
		}
		query := `
			SELECT id, category, title, content, cosine_similarity(embedding, $1) AS similarity
			FROM "docs-gemini-001"
			ORDER BY similarity DESC
			LIMIT $2;
		`
		rows, err = pool.Query(ctx, query, f64s, limit)
	}
	if err != nil {
		return nil, fmt.Errorf("failed to search similar documents: %w", err)
	}
	defer rows.Close()

	var results []SearchResult
	for rows.Next() {
		var item SearchResult
		if err := rows.Scan(&item.ID, &item.Category, &item.Title, &item.Content, &item.Similarity); err != nil {
			return nil, fmt.Errorf("failed scanning search result row: %w", err)
		}
		results = append(results, item)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error during row iteration: %w", err)
	}

	if results == nil {
		results = []SearchResult{}
	}
	return results, nil
}

// GetAllDocuments retrieves all documents from "docs-gemini-001" ordered by ID ascending.
func GetAllDocuments(ctx context.Context, pool *pgxpool.Pool, limit, offset int) ([]DocumentResponse, error) {
	if limit <= 0 {
		limit = 50
	}

	query := `
		SELECT id, category, title, content, created_at
		FROM "docs-gemini-001"
		ORDER BY id ASC
		LIMIT $1 OFFSET $2;
	`
	rows, err := pool.Query(ctx, query, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch documents: %w", err)
	}
	defer rows.Close()

	var docs []DocumentResponse
	for rows.Next() {
		var doc DocumentResponse
		if err := rows.Scan(&doc.ID, &doc.Category, &doc.Title, &doc.Content, &doc.CreatedAt); err != nil {
			return nil, fmt.Errorf("failed to scan document row: %w", err)
		}
		docs = append(docs, doc)
	}

	if docs == nil {
		docs = []DocumentResponse{}
	}
	return docs, nil
}

// GetDocumentByID retrieves a single document by its primary key ID from "docs-gemini-001".
func GetDocumentByID(ctx context.Context, pool *pgxpool.Pool, id int) (*DocumentResponse, error) {
	query := `
		SELECT id, category, title, content, created_at
		FROM "docs-gemini-001"
		WHERE id = $1;
	`
	var doc DocumentResponse
	err := pool.QueryRow(ctx, query, id).Scan(&doc.ID, &doc.Category, &doc.Title, &doc.Content, &doc.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &doc, nil
}

// UpdateDocument updates category, title, content, and the newly recomputed embedding vector in "docs-gemini-001".
func UpdateDocument(ctx context.Context, pool *pgxpool.Pool, id int, category, title, content string, embedding pgvector.Vector) error {
	if category == "" {
		category = "Umum"
	}
	query := `
		UPDATE "docs-gemini-001"
		SET category = $1, title = $2, content = $3, embedding = $4
		WHERE id = $5;
	`
	var err error
	var rowsAffected int64
	if HasPgVector {
		tag, execErr := pool.Exec(ctx, query, category, title, content, embedding, id)
		err = execErr
		rowsAffected = tag.RowsAffected()
	} else {
		f32s := embedding.Slice()
		f64s := make([]float64, len(f32s))
		for i, v := range f32s {
			f64s[i] = float64(v)
		}
		tag, execErr := pool.Exec(ctx, query, category, title, content, f64s, id)
		err = execErr
		rowsAffected = tag.RowsAffected()
	}
	if err != nil {
		return fmt.Errorf("failed to update document: %w", err)
	}
	if rowsAffected == 0 {
		return fmt.Errorf("document with id %d not found", id)
	}
	return nil
}

// DeleteDocument removes a document by its ID from "docs-gemini-001".
func DeleteDocument(ctx context.Context, pool *pgxpool.Pool, id int) error {
	query := `DELETE FROM "docs-gemini-001" WHERE id = $1;`
	tag, err := pool.Exec(ctx, query, id)
	if err != nil {
		return fmt.Errorf("failed to delete document: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("document with id %d not found", id)
	}
	return nil
}

// CountDocuments returns the total number of documents in "docs-gemini-001".
func CountDocuments(ctx context.Context, pool *pgxpool.Pool) (int64, error) {
	var count int64
	err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM "docs-gemini-001";`).Scan(&count)
	return count, err
}

// FindCachedFeedback searches for a previously answered query with cosine similarity >= threshold.
func FindCachedFeedback(ctx context.Context, pool *pgxpool.Pool, queryVec pgvector.Vector, threshold float64) (*QueryCacheHit, error) {
	var hit QueryCacheHit
	var feedbackBytes, matchedSourcesBytes []byte
	var err error

	if HasPgVector {
		query := `
			SELECT id, query_text, feedback, matched_sources, 1 - (query_embedding <=> $1) AS similarity, hit_count
			FROM query_cache
			WHERE 1 - (query_embedding <=> $1) >= $2
			ORDER BY query_embedding <=> $1 ASC
			LIMIT 1;
		`
		err = pool.QueryRow(ctx, query, queryVec, threshold).Scan(
			&hit.ID,
			&hit.QueryText,
			&feedbackBytes,
			&matchedSourcesBytes,
			&hit.Similarity,
			&hit.HitCount,
		)
	} else {
		f32s := queryVec.Slice()
		f64s := make([]float64, len(f32s))
		for i, v := range f32s {
			f64s[i] = float64(v)
		}
		query := `
			SELECT id, query_text, feedback, matched_sources, cosine_similarity(query_embedding, $1) AS similarity, hit_count
			FROM query_cache
			WHERE cosine_similarity(query_embedding, $1) >= $2
			ORDER BY similarity DESC
			LIMIT 1;
		`
		err = pool.QueryRow(ctx, query, f64s, threshold).Scan(
			&hit.ID,
			&hit.QueryText,
			&feedbackBytes,
			&matchedSourcesBytes,
			&hit.Similarity,
			&hit.HitCount,
		)
	}
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("failed to search query cache: %w", err)
	}

	hit.Feedback = feedbackBytes
	hit.MatchedSources = matchedSourcesBytes
	return &hit, nil
}

// IncrementCacheHit updates the hit counter and timestamp for a cache hit.
func IncrementCacheHit(ctx context.Context, pool *pgxpool.Pool, id int) error {
	query := `
		UPDATE query_cache
		SET hit_count = hit_count + 1, updated_at = CURRENT_TIMESTAMP
		WHERE id = $1;
	`
	_, err := pool.Exec(ctx, query, id)
	return err
}

// ClearQueryCache empties the semantic cache. Every cached answer was written
// from the documents as they were then, and there is no telling which ones a
// document change affects, so any change drops them all.
func ClearQueryCache(ctx context.Context, pool *pgxpool.Pool) error {
	if _, err := pool.Exec(ctx, `DELETE FROM query_cache;`); err != nil {
		return fmt.Errorf("failed clearing query cache: %w", err)
	}
	return nil
}

// InsertQueryCache saves a query embedding and generated feedback to the semantic cache table.
func InsertQueryCache(ctx context.Context, pool *pgxpool.Pool, queryText string, queryVec pgvector.Vector, feedback any, matchedSources any) error {
	feedbackBytes, err := json.Marshal(feedback)
	if err != nil {
		return fmt.Errorf("failed marshaling feedback for cache: %w", err)
	}

	sourcesBytes, err := json.Marshal(matchedSources)
	if err != nil {
		return fmt.Errorf("failed marshaling matched sources for cache: %w", err)
	}

	query := `
		INSERT INTO query_cache (query_text, query_embedding, feedback, matched_sources)
		VALUES ($1, $2, $3, $4);
	`
	if HasPgVector {
		_, err = pool.Exec(ctx, query, queryText, queryVec, feedbackBytes, sourcesBytes)
	} else {
		f32s := queryVec.Slice()
		f64s := make([]float64, len(f32s))
		for i, v := range f32s {
			f64s[i] = float64(v)
		}
		_, err = pool.Exec(ctx, query, queryText, f64s, feedbackBytes, sourcesBytes)
	}
	if err != nil {
		return fmt.Errorf("failed inserting query cache: %w", err)
	}
	return nil
}

