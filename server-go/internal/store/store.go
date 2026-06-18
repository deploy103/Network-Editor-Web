package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"time"
)

type Store struct {
	db *sql.DB
}

type User struct {
	ID           string    `json:"id"`
	Name         string    `json:"name"`
	Username     string    `json:"username"`
	Email        string    `json:"email"`
	BirthDate    string    `json:"birthDate"`
	PasswordHash string    `json:"-"`
	CreatedAt    time.Time `json:"createdAt"`
}

type Project struct {
	ID        string          `json:"id"`
	OwnerID   string          `json:"ownerId"`
	Name      string          `json:"name"`
	Payload   json.RawMessage `json:"payload"`
	CreatedAt time.Time       `json:"createdAt"`
	UpdatedAt time.Time       `json:"updatedAt"`
}

func NewPostgresStore(db *sql.DB) *Store {
	return &Store{db: db}
}

func (s *Store) Ping(ctx context.Context) error {
	return s.db.PingContext(ctx)
}

func (s *Store) CreateUser(ctx context.Context, user User) error {
	_, err := s.db.ExecContext(ctx, `
		insert into users (id, name, username, email, birth_date, password_hash)
		values ($1, $2, $3, $4, $5, $6)
	`, user.ID, user.Name, user.Username, user.Email, user.BirthDate, user.PasswordHash)
	return err
}

func (s *Store) UserByUsername(ctx context.Context, username string) (User, error) {
	var user User
	err := s.db.QueryRowContext(ctx, `
		select id, name, username, email, birth_date, password_hash, created_at
		from users
		where lower(username) = lower($1)
	`, username).Scan(&user.ID, &user.Name, &user.Username, &user.Email, &user.BirthDate, &user.PasswordHash, &user.CreatedAt)
	return user, err
}

func (s *Store) Projects(ctx context.Context, ownerID string) ([]Project, error) {
	rows, err := s.db.QueryContext(ctx, `
		select id, owner_id, name, payload, created_at, updated_at
		from projects
		where owner_id = $1
		order by updated_at desc
	`, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var projects []Project
	for rows.Next() {
		var project Project
		if err := rows.Scan(&project.ID, &project.OwnerID, &project.Name, &project.Payload, &project.CreatedAt, &project.UpdatedAt); err != nil {
			return nil, err
		}
		projects = append(projects, project)
	}
	return projects, rows.Err()
}

func (s *Store) UpsertProject(ctx context.Context, project Project) error {
	if len(project.Payload) > 5_000_000 {
		return errors.New("project payload is too large")
	}
	result, err := s.db.ExecContext(ctx, `
		insert into projects (id, owner_id, name, payload)
		values ($1, $2, $3, $4)
		on conflict (id) do update
		set name = excluded.name,
		    payload = excluded.payload,
		    updated_at = now()
		where projects.owner_id = excluded.owner_id
	`, project.ID, project.OwnerID, project.Name, project.Payload)
	if err != nil {
		return err
	}
	rows, err := result.RowsAffected()
	if err == nil && rows == 0 {
		return errors.New("project id belongs to another user")
	}
	return nil
}

func (s *Store) DeleteProject(ctx context.Context, ownerID string, projectID string) error {
	_, err := s.db.ExecContext(ctx, `delete from projects where owner_id = $1 and id = $2`, ownerID, projectID)
	return err
}
