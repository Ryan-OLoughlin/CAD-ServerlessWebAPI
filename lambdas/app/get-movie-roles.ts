import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { GetCommand, QueryCommand, type QueryCommandInput } from '@aws-sdk/lib-dynamodb';
import {
  ddb,
  isRoleItem,
  movieKey,
  parseId,
  tableName,
  toRole,
} from '../shared/db';
import { response } from '../shared/http';
import { logRequest } from '../shared/request-logger';

export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  logRequest(event);

  const movieId = parseId(event.pathParameters?.movieID);
  if (movieId === undefined) {
    return response(400, { message: 'movieID must be a positive safe integer' });
  }

  const actorParam = event.queryStringParameters?.actor;
  const actorId = parseId(actorParam);
  if (actorParam !== undefined && actorId === undefined) {
    return response(400, { message: 'actor must be a positive safe integer' });
  }

  try {
    // Confirm that the requested movie exists before looking up its roles.
    const movieResult = await ddb.send(
      new GetCommand({
        TableName: tableName,
        Key: { PK: movieKey(movieId), SK: movieKey(movieId) },
      }),
    );

    if (!movieResult.Item) {
      return response(404, { message: `Movie ${movieId} not found` });
    }

    const roles = [];
    let lastEvaluatedKey: QueryCommandInput['ExclusiveStartKey'];

    // Query all role items for the movie. Follow LastEvaluatedKey so a large
    // cast is not silently truncated at DynamoDB's 1 MB query-page limit.
    do {
      const queryResult = await ddb.send(
        new QueryCommand({
          TableName: tableName,
          KeyConditionExpression: actorId === undefined
            ? 'PK = :pk AND begins_with(SK, :rolePrefix)'
            : 'PK = :pk AND SK = :sk',
          ExpressionAttributeValues: actorId === undefined
            ? { ':pk': movieKey(movieId), ':rolePrefix': 'a#' }
            : { ':pk': movieKey(movieId), ':sk': `a#${actorId}` },
          ExclusiveStartKey: lastEvaluatedKey,
        }),
      );

      roles.push(...(queryResult.Items ?? []).filter(isRoleItem).map(toRole));
      lastEvaluatedKey = queryResult.LastEvaluatedKey;
    } while (lastEvaluatedKey);

    return response(200, { data: roles });
  } catch (err) {
    console.error('Failed to retrieve movie roles:', err);
    return response(500, { message: 'Internal server error' });
  }
};
