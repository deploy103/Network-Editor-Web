package auth

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"fmt"
	"strconv"
	"strings"

	"golang.org/x/crypto/argon2"
)

const (
	saltBytes = 16
	keyBytes  = 32
	timeCost  = 3
	memoryKB  = 64 * 1024
	threads   = 2
)

func HashPassword(password string) (string, error) {
	salt := make([]byte, saltBytes)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	key := argon2.IDKey([]byte(password), salt, timeCost, memoryKB, threads, keyBytes)
	return fmt.Sprintf("argon2id$%d$%d$%d$%s$%s", timeCost, memoryKB, threads, encode(salt), encode(key)), nil
}

func VerifyPassword(password string, encoded string) bool {
	parts := strings.Split(encoded, "$")
	if len(parts) != 6 || parts[0] != "argon2id" {
		return false
	}
	parsedTime, err := strconv.ParseUint(parts[1], 10, 32)
	if err != nil {
		return false
	}
	parsedMemory, err := strconv.ParseUint(parts[2], 10, 32)
	if err != nil {
		return false
	}
	parsedThreads, err := strconv.ParseUint(parts[3], 10, 8)
	if err != nil {
		return false
	}
	if parsedTime == 0 || parsedMemory == 0 || parsedThreads == 0 {
		return false
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil {
		return false
	}
	expected, err := base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil {
		return false
	}
	actual := argon2.IDKey([]byte(password), salt, uint32(parsedTime), uint32(parsedMemory), uint8(parsedThreads), uint32(len(expected)))
	return subtle.ConstantTimeCompare(actual, expected) == 1
}

func encode(value []byte) string {
	return base64.RawStdEncoding.EncodeToString(value)
}
