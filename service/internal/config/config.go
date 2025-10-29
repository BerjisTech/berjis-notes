package config

import (
	"os"
	"strconv"
)

type Config struct {
	AppName        string
	Env            string
	Port           string
	DatabaseURL    string
	CoreAPIBase    string
	AllowedOrigins string
	UploadDir      string
	AssetsBaseURL  string
	UploadMaxBytes int64
}

func getenv(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func getenvInt64(k string, def int64) int64 {
	if v := os.Getenv(k); v != "" {
		if parsed, err := strconv.ParseInt(v, 10, 64); err == nil {
			return parsed
		}
	}
	return def
}

func Load() Config {
	uploadMaxMB := getenvInt64("UPLOAD_MAX_MB", 10)
	if uploadMaxMB <= 0 {
		uploadMaxMB = 10
	}
	return Config{
		AppName:        getenv("APP_NAME", "berjis-notes"),
		Env:            getenv("APP_ENV", "development"),
		Port:           getenv("PORT", "8082"),
		DatabaseURL:    getenv("DATABASE_URL", "postgres://postgres:postgres@localhost:5435/berjis_notes?sslmode=disable"),
		CoreAPIBase:    getenv("CORE_API_BASE", "http://localhost:8080"),
		AllowedOrigins: getenv("ALLOWED_ORIGINS", "*"),
		UploadDir:      getenv("UPLOAD_DIR", "./uploads"),
		AssetsBaseURL:  getenv("ASSETS_BASE_URL", ""),
		UploadMaxBytes: uploadMaxMB * 1024 * 1024,
	}
}
