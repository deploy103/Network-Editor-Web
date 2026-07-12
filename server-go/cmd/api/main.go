package main

import (
	"context"
	"database/sql"
	"log"
	"net/http"
	"os"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"

	"network-editor-web/server-go/internal/httpapi"
	"network-editor-web/server-go/internal/store"
)

func main() {
	addr := env("ADDR", ":8080")
	dsn := env("DATABASE_URL", "postgres://network:network@localhost:5432/network_editor?sslmode=disable")

	db, err := sql.Open("pgx", dsn)
	if err != nil {
		log.Fatalf("open database: %v", err)
	}
	defer db.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := waitForDatabase(ctx, db); err != nil {
		log.Fatalf("database ping failed: %v", err)
	}

	dataStore := store.NewPostgresStore(db)
	if err := dataStore.EnsureSchema(ctx); err != nil {
		log.Fatalf("ensure database schema: %v", err)
	}

	api := httpapi.New(dataStore, env("SESSION_SECRET", "dev-session-secret-change-me"))
	server := &http.Server{
		Addr:              addr,
		Handler:           api.Routes(),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      20 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	log.Printf("network editor api listening on %s", addr)
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("listen: %v", err)
	}
}

func waitForDatabase(ctx context.Context, db *sql.DB) error {
	var lastErr error
	for {
		if err := db.PingContext(ctx); err == nil {
			return nil
		} else {
			lastErr = err
		}
		select {
		case <-ctx.Done():
			return lastErr
		case <-time.After(time.Second):
		}
	}
}

func env(key string, fallback string) string {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	return value
}
