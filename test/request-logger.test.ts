import { logRequest } from '../lambdas/shared/request-logger';
import { createEvent } from './helpers/api-event';

describe('logRequest', () => {
  it('logs the Cognito username, request path and query string', () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);

    logRequest(createEvent({
      path: '/actors/4321',
      pathParameters: { actorID: '4321' },
      queryStringParameters: { movie: '1234' },
    }));

    expect(log).toHaveBeenCalledWith('test-user   /actors/4321?movie=1234');
    log.mockRestore();
  });

  it('uses the fallback username when authorizer context is missing', () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);

    const event = createEvent({ path: '/actors/4321' });
    (event.requestContext as unknown as { authorizer?: unknown }).authorizer = undefined;
    logRequest(event);

    expect(log).toHaveBeenCalledWith('anonymous   /actors/4321');
    log.mockRestore();
  });

  it('logs the API key ID for administrator requests', () => {
  const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);

  const event = createEvent({ path: '/movies/roles' });

  const requestContext = event.requestContext as unknown as {
    authorizer?: unknown;
    identity?: { apiKeyId: string | null };
  };

  requestContext.authorizer = undefined;
  requestContext.identity = { apiKeyId: 'test-api-key-id' };

  logRequest(event);

  expect(log).toHaveBeenCalledWith(
    'api-key:test-api-key-id   /movies/roles',
  );

  log.mockRestore();
});
});
