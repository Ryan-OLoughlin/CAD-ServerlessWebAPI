#!/usr/bin/env bash

# ==================================================
# AWS configuration
# ==================================================

REGION="eu-west-1"
APP_STACK="AppApiStack"
AUTH_STACK="CognitoStack"
API_STAGE="dev"

# Cognito test account
TEST_USERNAME="${TEST_USERNAME:-testuser}"
TEST_EMAIL="${TEST_EMAIL:-20105917@setu.ie}"

# ==================================================
# Utility functions
# ==================================================

fail() {
echo "Error: $*" >&2
return 1
}

get_stack_output() {
local stack="$1"
local output="$2"

aws cloudformation describe-stacks \
    --stack-name "$stack" \
    --region "$REGION" \
    --query "Stacks[0].Outputs[?OutputKey=='${output}'].OutputValue | [0]" \
    --output text 2>/dev/null
}

# ==================================================
# Main environment setup
# ==================================================

load_api_env() {

# --------------------------------------------------
# 1. Check required commands
# --------------------------------------------------

for cmd in aws curl jq; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
        fail "$cmd is not installed."
        return 1
    fi
done

echo
echo "======================================"
echo " AWS API environment configuration"
echo "======================================"

# --------------------------------------------------
# 2. Verify CloudFormation stacks exist
# --------------------------------------------------

echo
echo "Checking deployed CloudFormation stacks..."

if ! aws cloudformation describe-stacks \
    --stack-name "$APP_STACK" \
    --region "$REGION" >/dev/null 2>&1; then
    fail "$APP_STACK does not exist. Deploy your application stack first."
    return 1
fi

if ! aws cloudformation describe-stacks \
    --stack-name "$AUTH_STACK" \
    --region "$REGION" >/dev/null 2>&1; then
    fail "$AUTH_STACK does not exist. Deploy your Cognito stack first."
    return 1
fi

# --------------------------------------------------
# 3. Retrieve APP_API_URL
# --------------------------------------------------

echo
echo "Retrieving APP_API_URL..."

APP_API_URL=$(get_stack_output "$APP_STACK" "AppApiUrl")

# Fallback: construct URL from API Gateway REST API ID

if [ -z "$APP_API_URL" ] || [ "$APP_API_URL" = "None" ]; then

    REST_API_ID=$(aws cloudformation list-stack-resources \
        --stack-name "$APP_STACK" \
        --region "$REGION" \
        --query "StackResourceSummaries[?ResourceType=='AWS::ApiGateway::RestApi'].PhysicalResourceId | [0]" \
        --output text 2>/dev/null)

    if [ -z "$REST_API_ID" ] || [ "$REST_API_ID" = "None" ]; then
        fail "Could not retrieve API Gateway REST API ID."
        return 1
    fi

    APP_API_URL="https://${REST_API_ID}.execute-api.${REGION}.amazonaws.com/${API_STAGE}"
fi

# --------------------------------------------------
# 4. Retrieve AUTH_API_URL
# --------------------------------------------------

echo "Retrieving AUTH_API_URL..."

AUTH_API_URL=$(get_stack_output "$AUTH_STACK" "AuthApiUrl")

if [ -z "$AUTH_API_URL" ] || [ "$AUTH_API_URL" = "None" ]; then
    fail "Could not retrieve AUTH_API_URL."
    return 1
fi

# Remove trailing slashes
APP_API_URL="${APP_API_URL%/}"
AUTH_API_URL="${AUTH_API_URL%/}"

# Validate URLs before making HTTP requests
if [[ ! "$APP_API_URL" =~ ^https?://[^/]+ ]]; then
    fail "Invalid APP_API_URL: $APP_API_URL"
    return 1
fi

if [[ ! "$AUTH_API_URL" =~ ^https?://[^/]+ ]]; then
    fail "Invalid AUTH_API_URL: $AUTH_API_URL"
    return 1
fi

echo "APP_API_URL:  $APP_API_URL"
echo "AUTH_API_URL: $AUTH_API_URL"

# --------------------------------------------------
# 5. Retrieve API Gateway API key
# --------------------------------------------------

echo
echo "Retrieving API key..."

KEY_ID=$(get_stack_output "$APP_STACK" "AdminApiKeyId")

if [ -z "$KEY_ID" ] || [ "$KEY_ID" = "None" ]; then
    fail "Could not retrieve AdminApiKeyId."
    return 1
fi

API_KEY=$(aws apigateway get-api-key \
    --api-key "$KEY_ID" \
    --include-value \
    --region "$REGION" \
    --query "value" \
    --output text 2>/dev/null)

if [ -z "$API_KEY" ] || [ "$API_KEY" = "None" ]; then
    fail "Could not retrieve API key value."
    return 1
fi

echo "API key retrieved successfully."

# --------------------------------------------------
# 6. Retrieve Cognito User Pool ID
# --------------------------------------------------

echo "Retrieving Cognito User Pool ID..."

USER_POOL_ID=$(get_stack_output "$AUTH_STACK" "UserPoolId")

if [ -z "$USER_POOL_ID" ] || [ "$USER_POOL_ID" = "None" ]; then
    fail "Could not retrieve Cognito User Pool ID from CloudFormation."
    return 1
fi

echo "Cognito User Pool: $USER_POOL_ID"

# --------------------------------------------------
# 7. Get test account password
# --------------------------------------------------

echo
echo "Cognito test account"
echo "Username: $TEST_USERNAME"
echo "Email: $TEST_EMAIL"

# Always request password interactively
unset TEST_PASSWORD

read -r -s -p "Password for test account: " TEST_PASSWORD
echo

if [[ -z "$TEST_PASSWORD" ]]; then
    fail "Password cannot be empty."
    return 1
fi

# --------------------------------------------------
# 8. Sign-in or register Cognito account
# --------------------------------------------------

# Request the password if it has not already been provided by env.sh.
if [[ -z "${TEST_PASSWORD:-}" ]]; then
    echo
    read -r -s -p "Enter Cognito test account password: " TEST_PASSWORD
    echo

    if [[ -z "$TEST_PASSWORD" ]]; then
        fail "Password cannot be empty."
        return 1
    fi
fi

echo
echo "Attempting to sign in to Cognito..."

SIGNIN_RESPONSE=$(curl -sS \
    --connect-timeout 10 \
    --max-time 30 \
    -X POST "$AUTH_API_URL/auth/signin" \
    -H "Content-Type: application/json" \
    -d "$(jq -n \
        --arg username "$TEST_USERNAME" \
        --arg password "$TEST_PASSWORD" \
        '{username: $username, password: $password}')" \
    -w '\n%{http_code}') || {
        fail "Could not connect to Cognito signin endpoint."
        return 1
    }

SIGNIN_STATUS="${SIGNIN_RESPONSE##*$'\n'}"
SIGNIN_BODY="${SIGNIN_RESPONSE%$'\n'*}"

CONFIRMATION_REQUIRED=false

if [[ "$SIGNIN_STATUS" =~ ^2[0-9][0-9]$ ]]; then

    echo "Cognito sign-in successful. Existing confirmed account will be used."

elif [[ "$SIGNIN_BODY" == *"UserNotConfirmedException"* ]]; then

    echo "Existing Cognito account requires email confirmation."
    CONFIRMATION_REQUIRED=true

elif [[ "$SIGNIN_STATUS" == "401" ]]; then

    echo "Account sign-in failed. Attempting to register the test account..."

    SIGNUP_RESPONSE=$(curl -sS \
        --connect-timeout 10 \
        --max-time 30 \
        -X POST "$AUTH_API_URL/auth/signup" \
        -H "Content-Type: application/json" \
        -d "$(jq -n \
            --arg username "$TEST_USERNAME" \
            --arg password "$TEST_PASSWORD" \
            --arg email "$TEST_EMAIL" \
            '{username: $username, password: $password, email: $email}')" \
        -w '\n%{http_code}') || {
            fail "Could not connect to Cognito signup endpoint."
            return 1
        }

    SIGNUP_STATUS="${SIGNUP_RESPONSE##*$'\n'}"
    SIGNUP_BODY="${SIGNUP_RESPONSE%$'\n'*}"

    if [[ ! "$SIGNUP_STATUS" =~ ^2[0-9][0-9]$ ]]; then

        echo "Signup HTTP status: $SIGNUP_STATUS"
        echo "Signup response:"
        echo "$SIGNUP_BODY" | jq . 2>/dev/null || echo "$SIGNUP_BODY"

        fail "Cognito registration failed. The account may already exist or the credentials may be incorrect."
        return 1
    fi

    echo "Cognito registration successful."
    CONFIRMATION_REQUIRED=true

else

    echo "Sign-in HTTP status: $SIGNIN_STATUS"
    echo "Sign-in response:"
    echo "$SIGNIN_BODY" | jq . 2>/dev/null || echo "$SIGNIN_BODY"

    fail "Unexpected Cognito sign-in response."
    return 1
fi


# --------------------------------------------------
# 9. Wait for email confirmation code (when required)
# --------------------------------------------------

if [[ "$CONFIRMATION_REQUIRED" == true ]]; then

    echo
    echo "======================================"
    echo " EMAIL CONFIRMATION REQUIRED"
    echo "======================================"

    echo "A confirmation code should have been sent to:"
    echo "$TEST_EMAIL"
    echo
    echo "Retrieve the code from your email."

    read -r -p "Enter Cognito confirmation code: " CONFIRMATION_CODE

    if [[ -z "$CONFIRMATION_CODE" ]]; then
        fail "Confirmation code cannot be empty."
        return 1
    fi


    # --------------------------------------------------
    # 9. Confirm Cognito account
    # --------------------------------------------------

    echo
    echo "Confirming Cognito account..."

    CONFIRM_RESPONSE=$(curl -sS \
        --connect-timeout 10 \
        --max-time 30 \
        -X POST "$AUTH_API_URL/auth/confirm_signup" \
        -H "Content-Type: application/json" \
        -d "$(jq -n \
            --arg username "$TEST_USERNAME" \
            --arg code "$CONFIRMATION_CODE" \
            '{username: $username, code: $code}')" \
        -w '\n%{http_code}') || {
            fail "Could not connect to Cognito confirmation endpoint."
            return 1
        }

    CONFIRM_STATUS="${CONFIRM_RESPONSE##*$'\n'}"
    CONFIRM_BODY="${CONFIRM_RESPONSE%$'\n'*}"

    if [[ ! "$CONFIRM_STATUS" =~ ^2[0-9][0-9]$ ]]; then

        echo "Confirmation HTTP status: $CONFIRM_STATUS"
        echo "Confirmation response:"
        echo "$CONFIRM_BODY" | jq . 2>/dev/null || echo "$CONFIRM_BODY"

        fail "Cognito account confirmation failed."
        return 1
    fi

    echo "Cognito account confirmed successfully."

    # --------------------------------------------------
    # 10. Sign in after confirmation
    # --------------------------------------------------

    echo
    echo "Signing in to Cognito..."

    SIGNIN_RESPONSE=$(curl -sS \
        --connect-timeout 10 \
        --max-time 30 \
        -X POST "$AUTH_API_URL/auth/signin" \
        -H "Content-Type: application/json" \
        -d "$(jq -n \
            --arg username "$TEST_USERNAME" \
            --arg password "$TEST_PASSWORD" \
            '{username: $username, password: $password}')" \
        -w '\n%{http_code}') || {
            fail "Could not connect to Cognito signin endpoint."
            return 1
        }

    SIGNIN_STATUS="${SIGNIN_RESPONSE##*$'\n'}"
    SIGNIN_BODY="${SIGNIN_RESPONSE%$'\n'*}"

    if [[ ! "$SIGNIN_STATUS" =~ ^2[0-9][0-9]$ ]]; then

        echo "Sign-in HTTP status: $SIGNIN_STATUS"
        echo "Sign-in response:"
        echo "$SIGNIN_BODY" | jq . 2>/dev/null || echo "$SIGNIN_BODY"

        fail "Cognito sign-in failed after confirmation."
        return 1
    fi

    echo "Cognito sign-in successful."

fi

# --------------------------------------------------
# 10. Authentication result
# --------------------------------------------------

echo
echo "Cognito authentication successful."

# Extract Cognito ID token

TOKEN=$(printf '%s' "$SIGNIN_BODY" | jq -r '.token // empty')

if [[ -z "$TOKEN" || "$TOKEN" == "null" ]]; then
    fail "Authentication succeeded but no token was returned."
    return 1
fi

# Construct application authentication cookie

COOKIE="token=$TOKEN"

echo "Cognito authentication successful."

# --------------------------------------------------
# 11. Export environment variables
# --------------------------------------------------

export APP_API_URL
export AUTH_API_URL
export API_KEY
export KEY_ID
export USER_POOL_ID
export TEST_USERNAME
export TEST_PASSWORD
export TOKEN
export COOKIE

echo
echo "======================================"
echo " ENVIRONMENT CONFIGURATION COMPLETE"
echo "======================================"

echo "APP_API_URL:  $APP_API_URL"
echo "AUTH_API_URL: $AUTH_API_URL"
echo "USERNAME:     $TEST_USERNAME"
echo "USER_POOL_ID: $USER_POOL_ID"
echo "COOKIE:       Available"
echo "API_KEY:      Available"
echo
echo "You can now execute your API tests."
}
# ==================================================
# Execute setup
# ==================================================

load_api_env
ENV_STATUS=$?

if [ "$ENV_STATUS" -ne 0 ]; then
    return "$ENV_STATUS" 2>/dev/null || exit "$ENV_STATUS"
fi