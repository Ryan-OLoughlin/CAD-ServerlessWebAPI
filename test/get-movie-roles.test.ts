import { ddb } from '../lambdas/shared/db';
import { handler } from '../lambdas/app/get-movie-roles';
import { createEvent, responseBody } from './helpers/api-event';

const movieItem = {
  PK: 'm#1234',
  SK: 'm#1234',
  movieId: 1234,
  title: 'The Shawshank Redemption',
  releaseDate: '05-03-1995',
  overview: 'A story of friendship and hope.',
};

const redRoleItem = {
  PK: 'm#1234',
  SK: 'a#4321',
  movieId: 1234,
  actorId: 4321,
  roleName: 'Ellis Boyd "Red" Redding',
  roleDescription: 'The film\'s narrator.',
};

const andyRoleItem = {
  PK: 'm#1234',
  SK: 'a#4322',
  movieId: 1234,
  actorId: 4322,
  roleName: 'Andy Dufresne',
  roleDescription: 'A banker wrongly convicted of murder.',
};

describe('GET /movies/{movieID}/roles', () => {
  let sendMock: jest.Mock;

  beforeEach(() => {
    sendMock = jest.spyOn(ddb, 'send') as jest.Mock;
    sendMock.mockReset();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('returns every role for an existing movie', async () => {
    sendMock
      .mockResolvedValueOnce({ Item: movieItem })
      .mockResolvedValueOnce({ Items: [redRoleItem, andyRoleItem] });

    const result = await handler(createEvent({
      path: '/movies/1234/roles',
      pathParameters: { movieID: '1234' },
    }));

    expect(result.statusCode).toBe(200);
    expect(responseBody<{ data: unknown[] }>(result).data).toEqual([
      {
        movieId: 1234,
        actorId: 4321,
        roleName: 'Ellis Boyd "Red" Redding',
        roleDescription: 'The film\'s narrator.',
      },
      {
        movieId: 1234,
        actorId: 4322,
        roleName: 'Andy Dufresne',
        roleDescription: 'A banker wrongly convicted of murder.',
      },
    ]);
    expect(sendMock).toHaveBeenCalledTimes(2);
  });

  it('filters roles by the optional actor query parameter', async () => {
    sendMock
      .mockResolvedValueOnce({ Item: movieItem })
      .mockResolvedValueOnce({ Items: [redRoleItem] });

    const result = await handler(createEvent({
      path: '/movies/1234/roles',
      pathParameters: { movieID: '1234' },
      queryStringParameters: { actor: '4321' },
    }));

    expect(result.statusCode).toBe(200);
    expect(responseBody<{ data: unknown[] }>(result).data).toHaveLength(1);
    expect(sendMock.mock.calls[1][0].input).toMatchObject({
      KeyConditionExpression: 'PK = :pk AND SK = :sk',
      ExpressionAttributeValues: { ':pk': 'm#1234', ':sk': 'a#4321' },
    });
  });

  it('follows DynamoDB pagination to return all roles', async () => {
    const lastKey = { PK: 'm#1234', SK: 'a#4321' };
    sendMock
      .mockResolvedValueOnce({ Item: movieItem })
      .mockResolvedValueOnce({ Items: [redRoleItem], LastEvaluatedKey: lastKey })
      .mockResolvedValueOnce({ Items: [andyRoleItem] });

    const result = await handler(createEvent({
      path: '/movies/1234/roles',
      pathParameters: { movieID: '1234' },
    }));

    expect(result.statusCode).toBe(200);
    expect(responseBody<{ data: unknown[] }>(result).data).toHaveLength(2);
    expect(sendMock).toHaveBeenCalledTimes(3);
    expect(sendMock.mock.calls[2][0].input.ExclusiveStartKey).toEqual(lastKey);
  });

  it('returns an empty data array when the movie has no roles', async () => {
    sendMock
      .mockResolvedValueOnce({ Item: movieItem })
      .mockResolvedValueOnce({ Items: [] });

    const result = await handler(createEvent({
      pathParameters: { movieID: '1234' },
    }));

    expect(result.statusCode).toBe(200);
    expect(responseBody<{ data: unknown[] }>(result).data).toEqual([]);
  });

  it('returns 400 for an invalid movie ID without querying DynamoDB', async () => {
    const result = await handler(createEvent({ pathParameters: { movieID: '12x' } }));

    expect(result.statusCode).toBe(400);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('returns 400 for an invalid actor filter without querying DynamoDB', async () => {
    const result = await handler(createEvent({
      pathParameters: { movieID: '1234' },
      queryStringParameters: { actor: '0' },
    }));

    expect(result.statusCode).toBe(400);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('returns 404 when the movie does not exist', async () => {
    sendMock.mockResolvedValueOnce({});

    const result = await handler(createEvent({ pathParameters: { movieID: '9999' } }));

    expect(result.statusCode).toBe(404);
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it('returns 500 when DynamoDB fails', async () => {
    sendMock.mockRejectedValueOnce(new Error('DynamoDB unavailable'));

    const result = await handler(createEvent({ pathParameters: { movieID: '1234' } }));

    expect(result.statusCode).toBe(500);
    expect(responseBody<{ message: string; error?: string }>(result)).toEqual({
      message: 'Internal server error',
    });
  });
});
