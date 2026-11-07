import { ddb } from '../lambdas/shared/db';
import { handler } from '../lambdas/app/add-movie-role';
import { createEvent, responseBody } from './helpers/api-event';

const movieItem = {
  PK: 'm#1234',
  SK: 'm#1234',
  movieId: 1234,
  title: 'The Shawshank Redemption',
};

const actorItem = {
  PK: 'a#4321',
  SK: 'a#4321',
  actorId: 4321,
  name: 'Morgan Freeman',
};

const validRole = {
  movieId: 1234,
  actorId: 4321,
  roleName: '  Ellis Boyd "Red" Redding  ',
  roleDescription: '  The film\'s narrator.  ',
};

const postEvent = (body: unknown) => createEvent({
  path: '/movies/roles',
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

describe('POST /movies/roles', () => {
  let sendMock: jest.Mock;

  beforeEach(() => {
    sendMock = jest.spyOn(ddb, 'send') as jest.Mock;
    sendMock.mockReset();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('creates a role after verifying the movie and actor exist', async () => {
    sendMock
      .mockResolvedValueOnce({ Item: movieItem })
      .mockResolvedValueOnce({ Item: actorItem })
      .mockResolvedValueOnce({});

    const result = await handler(postEvent(validRole));

    expect(result.statusCode).toBe(201);
    expect(responseBody<{ data: Record<string, unknown> }>(result).data).toEqual({
      movieId: 1234,
      actorId: 4321,
      roleName: 'Ellis Boyd "Red" Redding',
      roleDescription: 'The film\'s narrator.',
    });
    expect(sendMock).toHaveBeenCalledTimes(3);
    expect(sendMock.mock.calls[0][0].input.Key).toEqual({ PK: 'm#1234', SK: 'm#1234' });
    expect(sendMock.mock.calls[1][0].input.Key).toEqual({ PK: 'a#4321', SK: 'a#4321' });
    expect(sendMock.mock.calls[2][0].input).toMatchObject({
      Item: {
        PK: 'm#1234',
        SK: 'a#4321',
        movieId: 1234,
        actorId: 4321,
      },
      ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
    });
  });

  it('returns 400 for malformed JSON', async () => {
    const result = await handler(postEvent('{invalid-json'));

    expect(result.statusCode).toBe(400);
    expect(responseBody<{ message: string }>(result).message).toBe('Request body must be valid JSON');
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('returns 400 when the body is not a JSON object', async () => {
    const result = await handler(postEvent(['not', 'an', 'object']));

    expect(result.statusCode).toBe(400);
    expect(responseBody<{ message: string }>(result).message).toBe('Request body must be a JSON object');
    expect(sendMock).not.toHaveBeenCalled();
  });

  it.each([
    [{ ...validRole, movieId: '1234' }, 'movieId and actorId must be positive safe integers'],
    [{ ...validRole, actorId: 0 }, 'movieId and actorId must be positive safe integers'],
    [{ ...validRole, roleName: '   ' }, 'roleName and roleDescription must be non-empty strings'],
    [{ ...validRole, roleDescription: '' }, 'roleName and roleDescription must be non-empty strings'],
  ])('returns 400 for invalid role data', async (body, expectedMessage) => {
    const result = await handler(postEvent(body));

    expect(result.statusCode).toBe(400);
    expect(responseBody<{ message: string }>(result).message).toBe(expectedMessage);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('returns 404 when the referenced movie does not exist', async () => {
    sendMock.mockResolvedValueOnce({});

    const result = await handler(postEvent(validRole));

    expect(result.statusCode).toBe(404);
    expect(responseBody<{ message: string }>(result).message).toBe('Movie 1234 not found');
    expect(sendMock).toHaveBeenCalledTimes(2);
  });

  it('returns 404 when the referenced actor does not exist', async () => {
    sendMock
      .mockResolvedValueOnce({ Item: movieItem })
      .mockResolvedValueOnce({});

    const result = await handler(postEvent(validRole));

    expect(result.statusCode).toBe(404);
    expect(responseBody<{ message: string }>(result).message).toBe('Actor 4321 not found');
    expect(sendMock).toHaveBeenCalledTimes(2);
  });

  it('returns 409 when the role already exists', async () => {
    sendMock
      .mockResolvedValueOnce({ Item: movieItem })
      .mockResolvedValueOnce({ Item: actorItem })
      .mockRejectedValueOnce({ name: 'ConditionalCheckFailedException' });

    const result = await handler(postEvent(validRole));

    expect(result.statusCode).toBe(409);
    expect(responseBody<{ message: string }>(result).message).toContain('A role already exists');
  });

  it('returns 500 when DynamoDB fails unexpectedly', async () => {
    sendMock.mockRejectedValueOnce(new Error('DynamoDB unavailable'));

    const result = await handler(postEvent(validRole));

    expect(result.statusCode).toBe(500);
    expect(responseBody<{ message: string }>(result)).toEqual({
      message: 'Internal server error',
    });
  });
});