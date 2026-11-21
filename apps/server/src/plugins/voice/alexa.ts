/**
 * Alexa, straight to Mantel (v4 O). Amazon closed its list API to other apps on 1 July 2024, so
 * "Alexa, add milk to my shopping list" can no longer reach anything outside Amazon. What still
 * works is a private custom skill: "Alexa, ask Mantel to add milk and eggs". Its endpoint is this
 * route, reached over HTTPS from the internet, with a Mantel token in the URL (Alexa cannot send
 * headers). The skill's model comes from Settings, Siri and assistants.
 */
import { type TokenScope } from '@mantel/shared';
import type { Hono } from 'hono';
import type { AppDeps } from '../../app.js';
import { scopeAllows } from '../../auth.js';
import { log } from '../../log.js';
import { checkActionScope } from './index.js';
import type { OpenService } from './service.js';

export const ALEXA_PATH = '/api/alexa';

/** Alexa's own rule: refuse requests whose timestamp is more than 150 seconds off. */
const MAX_SKEW_MS = 150_000;

interface AlexaRequest {
  version?: string;
  request?: {
    type?: string;
    timestamp?: string;
    intent?: { name?: string; slots?: Record<string, { value?: string }> };
  };
}

const reply = (text: string, end = true, reprompt?: string) => ({
  version: '1.0',
  response: {
    outputSpeech: { type: 'PlainText', text },
    ...(reprompt ? { reprompt: { outputSpeech: { type: 'PlainText', text: reprompt } } } : {}),
    shouldEndSession: end,
  },
});

const HELP =
  'Say add, then what to add. For example: add milk and eggs, dentist Tuesday at 3, or tacos Thursday. Or ask what is on today.';

/** Answer one Alexa request for a token with `scopes`. */
export async function answerAlexa(
  body: AlexaRequest,
  scopes: TokenScope[],
  open: OpenService,
  now = Date.now(),
) {
  const req = body.request ?? {};
  if (req.timestamp && Math.abs(now - Date.parse(req.timestamp)) > MAX_SKEW_MS) return null;
  switch (req.type) {
    case 'LaunchRequest':
      return reply('What should I add to Mantel?', false, HELP);
    case 'SessionEndedRequest':
      return { version: '1.0', response: {} };
    case 'IntentRequest':
      break;
    default:
      return reply('Sorry, Mantel did not understand that.');
  }
  const name = req.intent?.name ?? '';
  if (name === 'AddIntent') {
    const thing = req.intent?.slots?.thing?.value?.trim();
    if (!thing) return reply('What should I add?', false, HELP);
    try {
      const said = await open.say({ text: thing, source: 'voice' }, (action) =>
        checkActionScope({ id: 'alexa', name: 'Alexa', scopes }, action),
      );
      return reply(said.speech);
    } catch (err) {
      return reply(err instanceof Error ? `Sorry, ${err.message}` : 'Sorry, that did not work.');
    }
  }
  if (name === 'TodayIntent' || name === 'TomorrowIntent') {
    if (!scopeAllows(scopes, ['read']))
      return reply(
        'This skill can add things but not read the day. Give its token the Read scope.',
      );
    const { text } = await open.todayText(name === 'TodayIntent' ? 'today' : 'tomorrow');
    return reply(text);
  }
  if (name === 'AMAZON.HelpIntent') return reply(HELP, false, HELP);
  if (name === 'AMAZON.StopIntent' || name === 'AMAZON.CancelIntent') return reply('Okay.');
  return reply(`Sorry, I did not catch that. ${HELP}`, false, HELP);
}

/** Mount `POST /api/alexa?token=mtl_...` on the root app (before the `/api` router). */
export function mountAlexa(app: Hono, deps: AppDeps, open: OpenService) {
  app.post(ALEXA_PATH, async (c) => {
    const who = deps.tokens.verify(c.req.query('token') ?? '');
    if (!who)
      return c.json(
        { error: { code: 'unauthorized', message: 'add ?token= to the endpoint' } },
        401,
      );
    let body: AlexaRequest;
    try {
      body = (await c.req.json()) as AlexaRequest;
    } catch {
      return c.json({ error: { code: 'bad_request', message: 'not JSON' } }, 400);
    }
    const answer = await answerAlexa(body, who.scopes, open);
    if (!answer) {
      log.warn('alexa: refused a request with an old timestamp');
      return c.json({ error: { code: 'bad_request', message: 'stale request' } }, 400);
    }
    return c.json(answer);
  });
}
