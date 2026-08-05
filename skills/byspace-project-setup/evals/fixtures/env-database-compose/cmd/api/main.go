package main

import (
	"fmt"
	"net/http"
	"os"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	if os.Getenv("DATABASE_URL") == "" {
		panic("DATABASE_URL is required")
	}
	http.HandleFunc("/health", func(w http.ResponseWriter, _ *http.Request) {
		fmt.Fprintln(w, "ok")
	})
	if err := http.ListenAndServe(":"+port, nil); err != nil {
		panic(err)
	}
}
