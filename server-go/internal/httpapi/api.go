package httpapi

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"regexp"
	"strings"
	"time"

	"network-editor-web/server-go/internal/auth"
	"network-editor-web/server-go/internal/store"
)

type API struct {
	store  *store.Store
	secret []byte
}

type signupRequest struct {
	Name            string `json:"name"`
	Username        string `json:"username"`
	Email           string `json:"email"`
	BirthDate       string `json:"birthDate"`
	Password        string `json:"password"`
	ConfirmPassword string `json:"confirmPassword"`
}

type loginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

func New(store *store.Store, secret string) *API {
	return &API{store: store, secret: []byte(secret)}
}

func (api *API) Routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", api.health)
	mux.HandleFunc("POST /api/signup", api.signup)
	mux.HandleFunc("POST /api/login", api.login)
	mux.HandleFunc("GET /api/projects", api.withUser(api.projects))
	mux.HandleFunc("PUT /api/projects", api.withUser(api.saveProject))
	mux.HandleFunc("DELETE /api/projects/", api.withUser(api.deleteProject))
	return cors(mux)
}

func (api *API) health(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	if err := api.store.Ping(ctx); err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "degraded", "database": "unavailable"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (api *API) signup(w http.ResponseWriter, r *http.Request) {
	var req signupRequest
	if !decodeJSON(w, r, &req, 20_000) {
		return
	}
	if err := validateSignup(req); err != "" {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	passwordHash, err := auth.HashPassword(req.Password)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "password hashing failed")
		return
	}
	user := store.User{
		ID:           newID("user"),
		Name:         clean(req.Name, 80),
		Username:     clean(req.Username, 40),
		Email:        clean(req.Email, 120),
		BirthDate:    clean(req.BirthDate, 10),
		PasswordHash: passwordHash,
	}
	if err := api.store.CreateUser(r.Context(), user); err != nil {
		writeError(w, http.StatusConflict, "username or email already exists")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"user": publicUser(user), "token": api.sign(user.ID)})
}

func (api *API) login(w http.ResponseWriter, r *http.Request) {
	var req loginRequest
	if !decodeJSON(w, r, &req, 10_000) {
		return
	}
	user, err := api.store.UserByUsername(r.Context(), clean(req.Username, 40))
	if err == sql.ErrNoRows {
		writeError(w, http.StatusUnauthorized, "invalid username or password")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "login failed")
		return
	}
	if !auth.VerifyPassword(req.Password, user.PasswordHash) {
		writeError(w, http.StatusUnauthorized, "invalid username or password")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"user": publicUser(user), "token": api.sign(user.ID)})
}

func (api *API) projects(w http.ResponseWriter, r *http.Request, userID string) {
	projects, err := api.store.Projects(r.Context(), userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load projects")
		return
	}
	documents := make([]json.RawMessage, 0, len(projects))
	for _, project := range projects {
		documents = append(documents, projectDocument(project))
	}
	writeJSON(w, http.StatusOK, map[string]any{"projects": documents})
}

func (api *API) saveProject(w http.ResponseWriter, r *http.Request, userID string) {
	raw, ok := decodeRawJSON(w, r, 5_000_000)
	if !ok {
		return
	}
	var envelope struct {
		ID      string          `json:"id"`
		Name    string          `json:"name"`
		Payload json.RawMessage `json:"payload"`
	}
	if err := json.Unmarshal(raw, &envelope); err != nil {
		writeError(w, http.StatusBadRequest, "invalid project json")
		return
	}
	payload := json.RawMessage(raw)
	if len(envelope.Payload) > 0 && json.Valid(envelope.Payload) {
		payload = envelope.Payload
	}
	projectID := clean(envelope.ID, 120)
	if projectID == "" {
		projectID = newID("project")
	}
	name := clean(envelope.Name, 100)
	if name == "" {
		name = "Untitled Network"
	}
	payload, err := normalizeProjectPayload(payload, projectID, userID, name)
	if err != nil {
		writeError(w, http.StatusBadRequest, "project payload must be a json object")
		return
	}
	req := store.Project{
		ID:      projectID,
		OwnerID: userID,
		Name:    name,
		Payload: payload,
	}
	if err := api.store.UpsertProject(r.Context(), req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"id": req.ID})
}

func (api *API) deleteProject(w http.ResponseWriter, r *http.Request, userID string) {
	projectID := strings.TrimPrefix(r.URL.Path, "/api/projects/")
	if projectID == "" {
		writeError(w, http.StatusBadRequest, "project id is required")
		return
	}
	if err := api.store.DeleteProject(r.Context(), userID, projectID); err != nil {
		writeError(w, http.StatusInternalServerError, "could not delete project")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (api *API) withUser(next func(http.ResponseWriter, *http.Request, string)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		userID, ok := api.verify(token)
		if !ok {
			writeError(w, http.StatusUnauthorized, "missing or invalid token")
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()
		next(w, r.WithContext(ctx), userID)
	}
}

func validateSignup(req signupRequest) string {
	if clean(req.Name, 80) == "" || clean(req.Username, 40) == "" || clean(req.Email, 120) == "" || clean(req.BirthDate, 10) == "" {
		return "name, username, email, and birthDate are required"
	}
	if !strings.Contains(req.Email, "@") {
		return "email is invalid"
	}
	if !regexp.MustCompile(`^[a-zA-Z0-9_.-]{3,40}$`).MatchString(clean(req.Username, 40)) {
		return "username must be 3-40 characters and use letters, numbers, dot, dash, or underscore"
	}
	if _, err := time.Parse("2006-01-02", clean(req.BirthDate, 10)); err != nil {
		return "birthDate must use YYYY-MM-DD"
	}
	if req.Password != req.ConfirmPassword {
		return "password confirmation does not match"
	}
	if len(req.Password) < 8 || !regexp.MustCompile(`[^a-zA-Z0-9]`).MatchString(req.Password) {
		return "password must be 8+ characters and include a special character"
	}
	return ""
}

func (api *API) sign(userID string) string {
	body := userID + "." + base64.RawURLEncoding.EncodeToString([]byte(time.Now().Add(24*time.Hour).UTC().Format(time.RFC3339)))
	mac := hmac.New(sha256.New, api.secret)
	mac.Write([]byte(body))
	return body + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func (api *API) verify(token string) (string, bool) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return "", false
	}
	body := parts[0] + "." + parts[1]
	mac := hmac.New(sha256.New, api.secret)
	mac.Write([]byte(body))
	expected := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	if !hmac.Equal([]byte(expected), []byte(parts[2])) {
		return "", false
	}
	expiresRaw, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return "", false
	}
	expires, err := time.Parse(time.RFC3339, string(expiresRaw))
	return parts[0], err == nil && time.Now().Before(expires)
}

func publicUser(user store.User) map[string]string {
	return map[string]string{"id": user.ID, "name": user.Name, "username": user.Username, "email": user.Email, "birthDate": user.BirthDate}
}

func decodeJSON(w http.ResponseWriter, r *http.Request, out any, maxBytes int64) bool {
	if !requireJSON(w, r) {
		return false
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxBytes)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(out); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json")
		return false
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		writeError(w, http.StatusBadRequest, "invalid json")
		return false
	}
	return true
}

func decodeRawJSON(w http.ResponseWriter, r *http.Request, maxBytes int64) ([]byte, bool) {
	if !requireJSON(w, r) {
		return nil, false
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxBytes)
	raw, err := io.ReadAll(r.Body)
	if err != nil || !json.Valid(raw) {
		writeError(w, http.StatusBadRequest, "invalid json")
		return nil, false
	}
	return raw, true
}

func requireJSON(w http.ResponseWriter, r *http.Request) bool {
	contentType := strings.ToLower(r.Header.Get("Content-Type"))
	if !strings.HasPrefix(contentType, "application/json") {
		writeError(w, http.StatusUnsupportedMediaType, "content type must be application/json")
		return false
	}
	return true
}

func normalizeProjectPayload(payload json.RawMessage, projectID string, userID string, name string) (json.RawMessage, error) {
	var document map[string]any
	if err := json.Unmarshal(payload, &document); err != nil || document == nil {
		if err != nil {
			return nil, err
		}
		return nil, errors.New("payload is not an object")
	}
	now := time.Now().UTC().Format(time.RFC3339)
	document["id"] = projectID
	document["ownerId"] = userID
	document["name"] = name
	document["updatedAt"] = now
	if _, ok := document["createdAt"]; !ok {
		document["createdAt"] = now
	}
	raw, err := json.Marshal(document)
	return json.RawMessage(raw), err
}

func projectDocument(project store.Project) json.RawMessage {
	var document map[string]any
	if err := json.Unmarshal(project.Payload, &document); err != nil || document == nil {
		document = map[string]any{}
	}
	document["id"] = project.ID
	document["ownerId"] = project.OwnerID
	document["name"] = project.Name
	document["createdAt"] = project.CreatedAt.UTC().Format(time.RFC3339)
	document["updatedAt"] = project.UpdatedAt.UTC().Format(time.RFC3339)
	raw, err := json.Marshal(document)
	if err != nil {
		return json.RawMessage(`{}`)
	}
	return json.RawMessage(raw)
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

func cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		allowedOrigin := os.Getenv("CORS_ORIGIN")
		if allowedOrigin == "" {
			allowedOrigin = "*"
		}
		origin := r.Header.Get("Origin")
		w.Header().Set("Vary", "Origin")
		w.Header().Set("Access-Control-Allow-Origin", pickAllowedOrigin(allowedOrigin, origin))
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func pickAllowedOrigin(allowedOrigin string, requestOrigin string) string {
	if allowedOrigin == "*" {
		return allowedOrigin
	}
	if requestOrigin == "" {
		return strings.TrimSpace(strings.Split(allowedOrigin, ",")[0])
	}
	for _, candidate := range strings.Split(allowedOrigin, ",") {
		if strings.TrimSpace(candidate) == requestOrigin {
			return requestOrigin
		}
	}
	return strings.TrimSpace(strings.Split(allowedOrigin, ",")[0])
}

func clean(value string, limit int) string {
	value = strings.TrimSpace(strings.ReplaceAll(strings.ReplaceAll(value, "<", ""), ">", ""))
	if len(value) > limit {
		return value[:limit]
	}
	return value
}

func newID(prefix string) string {
	bytes := make([]byte, 16)
	_, _ = rand.Read(bytes)
	return prefix + "_" + base64.RawURLEncoding.EncodeToString(bytes)
}
