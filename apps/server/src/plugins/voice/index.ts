/**
 * Open Mantel routes (v4 O): API tokens (made and revoked behind the admin PIN), natural add
 * (`POST /api/say`), the spoken summary for Siri (`GET /api/today.txt`) and the state the Home
 * Assistant integration reads (`GET /api/open/state`). Token scopes are enforced in
 * `contract.ts` from `TOKEN_ROUTE_SCOPES`; `/say` also checks the scope of what it is about to do.
 */
import { NoteCreateRequest, type SayAction, type TokenScope } from '@mantel/shared';
import type { AppDeps } from '../../app.js';
import { scopeAllows, type TokenIdentity } from '../../auth.js';
import type { Handle } from '../../contract.js';
import { HttpError, notFound } from '../../errors.js';
import { VERSION } from '../../version.js';
import { inboxFor } from '../inbox/index.js';
import type { MealsService } from '../meals/index.js';
import type { NoteStore } from '../notes/index.js';
import type { PushService } from '../push/service.js';
import { OpenService } from './service.js';

export { OpenService } from './service.js';

/** The scopes that may run each kind of action through `/say`. `capture` may run them all. */
const ACTION_SCOPES: Record<SayAction['kind'], TokenScope[]> = {
  items: ['capture', 'lists'],
  event: ['capture', 'calendar'],
  meal: ['capture', 'meals'],
  note: ['capture'],
  none: ['capture', 'lists', 'calendar', 'meals'],
};

export function checkActionScope(token: TokenIdentity | null, action: SayAction) {
  if (token && !scopeAllows(token.scopes, ACTION_SCOPES[action.kind]))
    throw new HttpError(
      'forbidden',
      `the token "${token.name}" cannot add ${action.kind === 'items' ? 'list items' : `${action.kind}s`}; give it Voice and notes in Settings`,
    );
}

export function createOpenService(
  deps: AppDeps,
  extra: { meals?: MealsService; notes: NoteStore; push: PushService },
): OpenService {
  const { providers, settings, registry, hub, config, db } = deps;
  const service = new OpenService({
    providers,
    inboxCount: () => inboxFor(db)?.store.pending() ?? 0,
    ...(extra.meals ? { meals: extra.meals } : {}),
    settings: () => settings.get(),
    claudeKey: () => registry.resolve('quips').secrets.claudeApiKey ?? '',
    version: VERSION,
    mock: config.MOCK,
    postNote: async (text, personId) => {
      const note = extra.notes.create(
        NoteCreateRequest.parse({ text, ...(personId ? { personId } : {}) }),
        null,
      );
      hub.broadcast({ type: 'notes.changed', payload: {} });
      void extra.push.notify('note', {
        title: 'A new note on the wall',
        body: note.text,
        url: '/app#note',
        tag: `note-${note.id}`,
      });
      return note;
    },
  });
  void service.primeChores();
  hub.onEvent((e) => service.handleEvent(e));
  return service;
}

export function registerOpenRoutes(handle: Handle, deps: AppDeps, open: OpenService) {
  const { auth, tokens, config } = deps;

  /** Making and revoking tokens needs the admin PIN (any PIN in mock mode). */
  const requirePin = (pin: string | undefined) => {
    if (config.MOCK) return;
    if (!auth.pinSet())
      throw new HttpError(
        'forbidden',
        'Set an admin PIN in Settings first; tokens are made behind it.',
      );
    if (auth.pinLocked())
      throw new HttpError('forbidden', 'Too many wrong PINs; wait 30 seconds and try again.');
    if (!pin || !auth.verifyPin(pin)) throw new HttpError('forbidden', 'That PIN is wrong.');
  };

  handle('openTokens', async () => ({ tokens: tokens.list() }));
  handle('openTokenCreate', async ({ body }) => {
    requirePin(body.pin);
    return tokens.create(body.name, body.scopes);
  });
  handle('openTokenRevoke', async ({ params, body }) => {
    requirePin(body?.pin);
    if (!tokens.revoke(params.id!)) throw notFound(`token ${params.id}`);
    return { ok: true as const };
  });

  handle('say', async ({ body, token }) =>
    open.say(body, (action) => checkActionScope(token, action)),
  );

  handle('openState', async () => open.state());

  handle('todayText', async ({ c, query }) => {
    const { text, date } = await open.todayText(query.day ?? 'today');
    if (query.format === 'json') return c.json({ text, date });
    return new Response(text, {
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    });
  });
}
