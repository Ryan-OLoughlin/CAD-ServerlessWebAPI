import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

export const createEvent = (options: {
  path?: string;
  pathParameters?: APIGatewayProxyEvent['pathParameters'];
  queryStringParameters?: APIGatewayProxyEvent['queryStringParameters'];
  body?: string | null;
} = {}): APIGatewayProxyEvent => ({
  path: options.path ?? '/',
  body: options.body ?? null,
  pathParameters: options.pathParameters ?? null,
  queryStringParameters: options.queryStringParameters ?? null,
  requestContext: {
    authorizer: { username: 'test-user' },
  },
} as unknown as APIGatewayProxyEvent);

export const responseBody = <T>(result: APIGatewayProxyResult): T =>
  JSON.parse(result.body) as T;
