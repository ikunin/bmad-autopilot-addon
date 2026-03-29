# Feature Specification: Token Authentication for json-server

## Overview
Add optional token-based authentication middleware to json-server. When enabled, all data endpoints require a valid Bearer token in the Authorization header.

## Requirements

### 1. Auth Flag
- New CLI flag: `--auth` (boolean, default: false)
- When `--auth` is passed, authentication middleware is activated
- When not passed, server behaves exactly as before (backwards compatible)

### 2. Login Endpoint
- `POST /auth/login` accepts JSON body: `{ "email": "...", "password": "..." }`
- Validates credentials against a `users` array in `db.json`
- Returns `{ "token": "<jwt-like-token>" }` on success (use a simple hash, no real JWT needed)
- Returns 401 on invalid credentials

### 3. Auth Middleware
- Checks `Authorization: Bearer <token>` header on all routes except `/auth/login`
- Returns 401 with `{ "error": "Unauthorized" }` if token is missing or invalid
- Passes through to next middleware if token is valid

### 4. Users in db.json
- Users are stored in a `users` array in the database file
- Each user has: `id`, `email`, `password` (plaintext for simplicity)
- Passwords are not exposed in GET /users responses (filtered out)

## Technical Constraints
- Must not break any existing json-server tests
- Must work with the existing Express middleware chain
- No new npm dependencies (use built-in crypto for token generation)

## Test Requirements
- Unit tests for token generation and validation
- Integration tests for login endpoint (success + failure)
- Integration tests for protected routes (with + without token)
- Regression: all existing json-server tests must still pass
