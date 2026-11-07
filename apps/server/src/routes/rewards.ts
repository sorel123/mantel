import type { Handle } from '../contract.js';
import { HttpError } from '../errors.js';
import type { AppDeps } from '../app.js';

/**
 * v3 workstream R: stars, rewards and routines. Spending stars and changing them by hand
 * needs the admin PIN (in mock mode any PIN works), so a child can't redeem on their own.
 */
export function registerRewardRoutes(handle: Handle, deps: AppDeps) {
  const { providers, auth, config } = deps;
  const lists = () => providers.lists;

  const requirePin = (pin: string) => {
    if (!auth.pinSet() && !config.MOCK)
      throw new HttpError(
        'forbidden',
        'Set an admin PIN in Settings first; it approves spending stars',
      );
    if (auth.pinLocked())
      throw new HttpError('forbidden', 'Too many wrong PINs; wait 30 seconds and try again');
    if (!auth.verifyPin(pin)) throw new HttpError('forbidden', 'That PIN is wrong');
  };

  handle('choreUpdate', async ({ params, body }) => lists().updateChore(params.id!, body));
  handle('starsBalance', async () => lists().starsBalance());
  handle('starsLedger', async ({ query }) => lists().starsLedger(query.personId, query.limit));
  handle('starsAdjust', async ({ body: { pin, ...req } }) => {
    requirePin(pin);
    return lists().starsAdjust(req);
  });
  handle('rewards', async () => lists().rewards());
  handle('rewardCreate', async ({ body }) => lists().createReward(body));
  handle('rewardPatch', async ({ params, body }) => lists().patchReward(params.id!, body));
  handle('rewardDelete', async ({ params }) => lists().deleteReward(params.id!));
  handle('rewardRedeem', async ({ params, body }) => {
    requirePin(body.pin);
    return lists().redeemReward(params.id!, body.personId);
  });
  handle('routines', async () => lists().routines());
  handle('routineCreate', async ({ body }) => lists().createRoutine(body));
  handle('routinePatch', async ({ params, body }) => lists().patchRoutine(params.id!, body));
  handle('routineDelete', async ({ params }) => lists().deleteRoutine(params.id!));
}
