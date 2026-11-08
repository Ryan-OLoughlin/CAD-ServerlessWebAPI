#!/usr/bin/env bash

set -Eeuo pipefail

: "${APP_API_URL:?APP_API_URL is not set. Run: source ./env.sh}"
: "${COOKIE:?COOKIE is not set. Run: source ./env.sh}"
: "${API_KEY:?API_KEY is not set. Run: source ./env.sh}"

# Remove a trailing slash so the endpoint paths below concatenate cleanly.
APP_API_URL="${APP_API_URL%/}"

request() {
  local title="$1"
  shift
  printf '\n\n============================================================\n'
  printf '%s\n' "$title"
  printf '%s\n' '============================================================'
  curl --silent --show-error --include "$@" \
    --write-out '\nHTTP status: %{http_code}\n'
}

get_auth=(-H "Cookie: ${COOKIE}")
post_auth=(-H "Cookie: ${COOKIE}" -H "Content-Type: application/json")
admin_headers=(-H "X-API-Key: ${API_KEY}" -H "Content-Type: application/json")

printf 'App API: %s\n' "$APP_API_URL"
printf 'Using seeded sample data: movie 1234, actors 4321 and 4322.\n'
printf 'The POST success example adds actor 4323 to movie 1234.\n'

# ---------------------------------------------------------------------------
# Authentication / authorisation
# ---------------------------------------------------------------------------
request '1. GET without Cognito cookie: should be rejected (HTTP 401)' \
  "$APP_API_URL/movies/1234/roles"

request '2. POST without administrator API key: should be rejected (HTTP 403)' \
  -X POST "$APP_API_URL/movies/roles" \
  -H 'Content-Type: application/json' \
  --data '{"movieId":1234,"actorId":4323,"roleName":"Test role","roleDescription":"Demonstration role"}'

# ---------------------------------------------------------------------------
# GET /movies/{movieID}/roles and optional actor filter
# ---------------------------------------------------------------------------
request '3. GET all roles for movie 1234: should return both seeded roles' \
  "${get_auth[@]}" "$APP_API_URL/movies/1234/roles"

request '4. GET movie 1234 filtered to actor 4321: should return one role' \
  "${get_auth[@]}" "$APP_API_URL/movies/1234/roles?actor=4321"

request '5. GET movie 1234 with invalid actor query: should return HTTP 400' \
  "${get_auth[@]}" "$APP_API_URL/movies/1234/roles?actor=not-a-number"

request '6. GET unknown movie: should return HTTP 404' \
  "${get_auth[@]}" "$APP_API_URL/movies/999999/roles"

# ---------------------------------------------------------------------------
# GET /actors/{actorID} and optional movie enrichment
# ---------------------------------------------------------------------------
request '7. GET actor 4321 profile: should return Morgan Freeman profile' \
  "${get_auth[@]}" "$APP_API_URL/actors/4321"

request '8. GET actor 4321 with movie 1234: should include the Red role' \
  "${get_auth[@]}" "$APP_API_URL/actors/4321?movie=1234"

request '9. GET actor 4322 with movie 1235: should include role: null (no matching role)' \
  "${get_auth[@]}" "$APP_API_URL/actors/4322?movie=1235"

request '10. GET actor with invalid movie query: should return HTTP 400' \
  "${get_auth[@]}" "$APP_API_URL/actors/4321?movie=invalid"

request '11. GET unknown actor: should return HTTP 404' \
  "${get_auth[@]}" "$APP_API_URL/actors/999999"

# ---------------------------------------------------------------------------
# POST /movies/roles: API key required, body validation and persistence
# ---------------------------------------------------------------------------
request '12. POST malformed JSON with API key: should return HTTP 400' \
  -X POST "$APP_API_URL/movies/roles" \
  "${admin_headers[@]}" \
  --data '{not-valid-json'

request '13. POST invalid IDs with API key: should return HTTP 400' \
  -X POST "$APP_API_URL/movies/roles" \
  "${admin_headers[@]}" \
  --data '{"movieId":"1234","actorId":4323,"roleName":"Test role","roleDescription":"Invalid movie ID type"}'

request '14. POST with unknown movie: should return HTTP 404' \
  -X POST "$APP_API_URL/movies/roles" \
  "${admin_headers[@]}" \
  --data '{"movieId":999999,"actorId":4323,"roleName":"Test role","roleDescription":"Movie does not exist"}'

request '15. POST with unknown actor: should return HTTP 404' \
  -X POST "$APP_API_URL/movies/roles" \
  "${admin_headers[@]}" \
  --data '{"movieId":1234,"actorId":999999,"roleName":"Test role","roleDescription":"Actor does not exist"}'

request '16. POST an already-seeded movie/actor pair: should return HTTP 409' \
  -X POST "$APP_API_URL/movies/roles" \
  "${admin_headers[@]}" \
  --data '{"movieId":1234,"actorId":4321,"roleName":"Duplicate test","roleDescription":"This relationship already exists"}'

# This pair is not in the seed data. The first run should return 201. Subsequent
# runs return 409 because the API correctly prevents duplicate relationships.
request '17. POST a new role (movie 1234 / actor 4323): first run 201, later runs 409' \
  -X POST "$APP_API_URL/movies/roles" \
  "${admin_headers[@]}" \
  --data '{"movieId":1234,"actorId":4323,"roleName":"Demonstration role","roleDescription":"A role created to demonstrate the administrator POST endpoint."}'

request '18. GET actor 4323 enriched with movie 1234: confirms the POST was persisted' \
  "${get_auth[@]}" "$APP_API_URL/actors/4323?movie=1234"

printf '\n\n============================================================\n'
printf '%s\n' 'Demonstration requests completed.'
printf '%s\n' 'Review the HTTP status and JSON body for each request above.'
printf '%s\n' 'The successful and rejected requests should also generate CloudWatch logs.'
printf '%s\n' '============================================================\n'
