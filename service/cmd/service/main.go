package main

import (
	"log"
	"os"

	"github.com/joho/godotenv"

	"github.com/berjistech/berjis-ecosystem/file-management/notes/service/internal/config"
	"github.com/berjistech/berjis-ecosystem/file-management/notes/service/internal/db"
	"github.com/berjistech/berjis-ecosystem/file-management/notes/service/internal/migrate"
	"github.com/berjistech/berjis-ecosystem/file-management/notes/service/internal/server"
)

func main() {
	_ = godotenv.Load()
	cfg := config.Load()

	conn, err := db.Connect(cfg.DatabaseURL)
	if err != nil {
		log.Printf("warn: failed to connect to notes DB: %v", err)
	} else {
		runner := migrate.Runner{Dir: "./migrations"}
		if err := runner.Up(conn); err != nil {
			log.Printf("warn: migrations failed: %v", err)
		}
	}

	if cfg.UploadDir != "" {
		if err := os.MkdirAll(cfg.UploadDir, 0o755); err != nil {
			log.Printf("warn: failed to create upload dir %s: %v", cfg.UploadDir, err)
		}
	}

	app := server.New(server.Options{
		AllowedOrigins: cfg.AllowedOrigins,
		CoreAPIBase:    cfg.CoreAPIBase,
		DB:             conn,
		UploadDir:      cfg.UploadDir,
		AssetsBaseURL:  cfg.AssetsBaseURL,
		UploadMaxBytes: cfg.UploadMaxBytes,
	})
	addr := ":" + cfg.Port
	log.Printf("starting %s on %s (env=%s)", cfg.AppName, addr, cfg.Env)
	if err := app.Listen(addr); err != nil {
		log.Println("shutdown:", err)
		os.Exit(1)
	}
}
