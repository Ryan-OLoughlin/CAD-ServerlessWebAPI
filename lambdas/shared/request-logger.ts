import type { APIGatewayProxyEvent } from 'aws-lambda';

export const logRequest = (
  event: APIGatewayProxyEvent,
  fallbackUsername = 'anonymous',
): void => {
  const authorizerContext = event.requestContext.authorizer as
    | Record<string, unknown>
    | null
    | undefined;

  // Prefer the username supplied by the validated Cognito authorizer.
  const cognitoUsername =
    typeof authorizerContext?.username === 'string'
      ? authorizerContext.username
      : undefined;

  // API Gateway provides the key ID for requests authenticated with an API key.
  // Never log the actual API key value.
  const apiKeyId = event.requestContext.identity?.apiKeyId;

  const requester =
    cognitoUsername ??
    (typeof apiKeyId === 'string' && apiKeyId.length > 0
      ? `api-key:${apiKeyId}`
      : fallbackUsername);

  const params = Object.entries(
    event.queryStringParameters ?? {},
  ).filter(
    (entry): entry is [string, string] =>
      entry[1] !== undefined && entry[1] !== null,
  );

  const query = params.length
    ? `?${new URLSearchParams(params)}`
    : '';

  console.log(`${requester}   ${event.path}${query}`);
};