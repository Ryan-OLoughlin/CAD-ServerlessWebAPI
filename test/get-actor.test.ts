import { ddb } from '../lambdas/shared/db';
import { handler } from '../lambdas/app/get-actor';
import { createEvent, responseBody } from './helpers/api-event';

const actorItem = {
  PK: 'a#4321',
  SK: 'a#4321',
  actorId: 4321,
  name: 'Morgan Freeman',
  dateOfBirth: '01-06-1937',
  bio: 'An American actor, producer and narrator.',
};

const roleItem = {
  PK: 'm#1234',
  SK: 'a#4321',
  movieId: 1234,
  actorId: 4321,
  roleName: 'Ellis Boyd "Red" Redding',
  roleDescription: 'The film\'s narrator.',
};

describe('GET /actors/{actorID}', () => {
  let sendMock: jest.Mock;

  beforeEach(() => {
    sendMock = jest.spyOn(ddb, 'send') as jest.Mock;
    sendMock.mockReset();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('returns the actor profile when no movie is specified', async () => {
    sendMock.mockResolvedValueOnce({ Item: actorItem });

    const result = await handler(createEvent({
      path: '/actors/4321',
      pathParameters: { actorID: '4321' },
    }));

    expect(result.statusCode).toBe(200);
    expect(responseBody<{ data: Record<string, unknown> }>(result).data).toEqual({
      actorId: 4321,
      name: 'Morgan Freeman',
      dateOfBirth: '01-06-1937',
      bio: 'An American actor, producer and narrator.',
    });
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it('includes the actor role when the optional movie parameter matches', async () => {
    sendMock
      .mockResolvedValueOnce({ Item: actorItem })
      .mockResolvedValueOnce({ Item: roleItem });

    const result = await handler(createEvent({
      path: '/actors/4321',
      pathParameters: { actorID: '4321' },
      queryStringParameters: { movie: '1234' },
    }));

    expect(result.statusCode).toBe(200);
    expect(responseBody<{ data: Record<string, unknown> }>(result).data).toEqual({
      actorId: 4321,
      name: 'Morgan Freeman',
      dateOfBirth: '01-06-1937',
      bio: 'An American actor, producer and narrator.',
      role: {
        movieId: 1234,
        actorId: 4321,
        roleName: 'Ellis Boyd "Red" Redding',
        roleDescription: 'The film\'s narrator.',
      },
    });
    expect(sendMock).toHaveBeenCalledTimes(2);
  });

  it('returns a null role when the actor has no role in the requested movie', async () => {
    sendMock
      .mockResolvedValueOnce({ Item: actorItem })
      .mockResolvedValueOnce({});

    const result = await handler(createEvent({
      pathParameters: { actorID: '4321' },
      queryStringParameters: { movie: '1235' },
    }));

    expect(result.statusCode).toBe(200);
    expect(responseBody<{ data: { role: unknown } }>(result).data.role).toBeNull();
  });

  it('returns 400 for an invalid actor ID without querying DynamoDB', async () => {
    const result = await handler(createEvent({ pathParameters: { actorID: '4.321' } }));

    expect(result.statusCode).toBe(400);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('returns 400 for an invalid movie query parameter without querying DynamoDB', async () => {
    const result = await handler(createEvent({
      pathParameters: { actorID: '4321' },
      queryStringParameters: { movie: 'not-a-number' },
    }));

    expect(result.statusCode).toBe(400);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('returns 404 when the actor does not exist', async () => {
    sendMock.mockResolvedValueOnce({});

    const result = await handler(createEvent({ pathParameters: { actorID: '9999' } }));

    expect(result.statusCode).toBe(404);
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it('returns 500 when DynamoDB fails', async () => {
    sendMock.mockRejectedValueOnce(new Error('DynamoDB unavailable'));

    const result = await handler(createEvent({ pathParameters: { actorID: '4321' } }));

    expect(result.statusCode).toBe(500);
    expect(responseBody<{ message: string }>(result)).toEqual({
      message: 'Internal server error',
    });
  });
});
