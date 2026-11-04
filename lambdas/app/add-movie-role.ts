import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { actorKey, ddb, movieKey, type Role, tableName } from '../shared/db';
import { isResponse, parseJsonObject, response } from '../shared/http';
import { logRequest } from '../shared/request-logger';

const isValidId = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  logRequest(event);
  const body = parseJsonObject(event);
  if (isResponse(body)) return body;

  // IDs in the JSON request body must be numbers, not numeric strings.
  if (!isValidId(body.movieId) || !isValidId(body.actorId)) {
    return response(400, {
      message: 'movieId and actorId must be positive safe integers',
    });
  }

  if (!isNonEmptyString(body.roleName) || !isNonEmptyString(body.roleDescription)) {
    return response(400, {
      message: 'roleName and roleDescription must be non-empty strings',
    });
  }

  const role: Role = {
    movieId: body.movieId,
    actorId: body.actorId,
    roleName: body.roleName.trim(),
    roleDescription: body.roleDescription.trim(),
  };

  try {
    // Confirm both referenced entities exist before creating the relationship.
    const [movieResult, actorResult] = await Promise.all([
      ddb.send(new GetCommand({
        TableName: tableName,
        Key: { PK: movieKey(role.movieId), SK: movieKey(role.movieId) },
      })),
      ddb.send(new GetCommand({
        TableName: tableName,
        Key: { PK: actorKey(role.actorId), SK: actorKey(role.actorId) },
      })),
    ]);

    if (!movieResult.Item) {
      return response(404, { message: `Movie ${role.movieId} not found` });
    }

    if (!actorResult.Item) {
      return response(404, { message: `Actor ${role.actorId} not found` });
    }

    // The conditional write prevents duplicate roles, including concurrent requests.
    await ddb.send(new PutCommand({
      TableName: tableName,
      Item: {
        PK: movieKey(role.movieId),
        SK: actorKey(role.actorId),
        ...role,
      },
      ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
    }));

    return response(201, { message: 'Role added', data: role });
  } catch (err) {
    if (
      typeof err === 'object' &&
      err !== null &&
      'name' in err &&
      err.name === 'ConditionalCheckFailedException'
    ) {
      return response(409, {
        message: `A role already exists for movie ${role.movieId} and actor ${role.actorId}`,
      });
    }

    console.error('Failed to add movie role:', err);
    return response(500, { message: 'Internal server error' });
  }
};
