import { create } from 'zustand';
import type { Session, User } from '@supabase/supabase-js';
import { isConfigured, supabase } from '@/lib/supabase';
import {
  checkBiometricsSupport,
  clearBiometricCredentials,
  purgeLegacyCredentials,
  rememberCredentials,
  unlockRememberedCredentials,
} from '@/services/biometrics';
import * as db from '@/services/db';
import { haptic } from '@/lib/haptics';

/**
 * Authentication state.
 *
 * `status` is the single thing routing reads, and it has a distinct value for
 * "we have not looked yet". Without it the root layout flashes the sign-in
 * screen for a frame on every cold start while the stored session is being
 * read off disk.
 */
export type AuthStatus = 'loading' | 'signed-out' | 'signed-in';

type AuthState = {
  status: AuthStatus;
  session: Session | null;
  user: User | null;
  /** Set when the last call failed. Cleared on the next attempt. */
  error: string | null;
  /** True while a sign-in/sign-up round trip is open. */
  busy: boolean;
  /** Initial screen to show in (auth) flow ('sign-in' or 'sign-up') */
  authInitialScreen: 'sign-in' | 'sign-up';
  setAuthInitialScreen: (screen: 'sign-in' | 'sign-up') => void;
  /**
   * Where the tour should hand back to, when it was re-entered from an account
   * screen rather than reached on a first run.
   *
   * The tour finishes into sign-up, which is right for somebody who has just
   * been told what the app is and has no account. It is wrong for somebody who
   * was on **sign-in**, stepped back to re-read that pitch, and pressed Skip —
   * they were trying to log in, and dropping them on a create-account form is
   * the tour answering a question they did not ask.
   *
   * `null` means "nobody stepped back in", i.e. a genuine first run, and the
   * tour's own default applies. Set on the way out of an account screen and
   * cleared as soon as it is spent, so it never outlives the one trip it
   * describes.
   */
  tourExitScreen: 'sign-in' | 'sign-up' | null;
  setTourExitScreen: (screen: 'sign-in' | 'sign-up' | null) => void;
  /**
   * The address a six-digit code was sent to, and the whole reason the verify
   * screen exists — `(auth)/_layout.tsx` guards on it, so setting it routes to
   * verification and clearing it comes back here.
   */
  pendingConfirmation: string | null;
  /**
   * A password reset in progress: the address a recovery code went to, and
   * whether that code has been accepted yet.
   *
   * Non-null is what routes to the reset screen — `(auth)/_layout.tsx` guards on
   * it, exactly as the verify screen guards on `pendingConfirmation`.
   *
   * `verified` matters beyond drawing the second step. Accepting a recovery code
   * *opens a session*, so from that moment `status` is 'signed-in' and nothing
   * else stands between the user and the feed — with a password they still do
   * not know. The root layout keeps the account gate closed for as long as this
   * is set, so the only way out of the flow is to finish it or to cancel it.
   */
  recovery: { email: string; verified: boolean } | null;

  init: () => void;
  signUp: (email: string, password: string, name: string) => Promise<boolean>;
  signIn: (email: string, password: string) => Promise<boolean>;
  signInWithBiometrics: () => Promise<boolean>;
  /**
   * Saves the credentials behind the biometric prompt, after the user has said
   * yes to being asked.
   *
   * Deliberately not folded into `signIn`: this writes a password to the
   * Keychain, which is not something to do to somebody silently because they
   * happened to log in.
   */
  enableBiometricSignIn: (email: string, password: string) => Promise<boolean>;
  /**
   * Signs out *and* deletes the saved biometric credentials, everywhere.
   *
   * The ordinary `signOut` keeps them, so biometric sign-in still works on this
   * handset; this is the one that ends that and revokes every other session.
   * Settings needs both, and conflating them means either every sign-out costs
   * the user their setup or no sign-out ever really clears the device.
   */
  forgetDevice: () => Promise<void>;
  /** Confirms the sign-up with the code from the email. */
  verifyOtp: (token: string) => Promise<boolean>;
  /** Sends a fresh code to the pending address. */
  resendOtp: () => Promise<boolean>;
  /** Emails a recovery code and opens the reset flow. */
  requestPasswordReset: (email: string) => Promise<boolean>;
  /** Sends a fresh recovery code to the address being reset. */
  resendRecoveryCode: () => Promise<boolean>;
  /** Accepts the recovery code, which opens a session to change the password in. */
  verifyRecoveryCode: (token: string) => Promise<boolean>;
  /** Sets the new password and finishes the reset, leaving the user signed in. */
  setNewPassword: (password: string) => Promise<boolean>;
  /** Abandons the reset, closing any session the code opened. */
  cancelRecovery: () => Promise<void>;
  signOut: () => Promise<void>;
  clearError: () => void;
  /** Abandons verification and returns to sign-up. */
  cancelConfirmation: () => void;
};

/**
 * Supabase surfaces these verbatim to the user, and its wording assumes a web
 * developer is reading it. Anything not translated here is passed through.
 */
function readable(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('invalid login credentials')) return 'That email and password do not match.';
  if (m.includes('already registered')) return 'There is already an account with that email.';
  if (m.includes('password should be')) return 'Passwords need to be at least 6 characters.';
  if (m.includes('unable to validate email')) return 'That does not look like an email address.';
  if (m.includes('email not confirmed')) return 'Confirm your email address first, then sign in.';
  if (m.includes('network')) return 'Could not reach Supabase. Check your connection.';
  // Both wordings come back from `verifyOtp` for a code that is wrong, already
  // used, or past its window. The user cannot tell those apart and does not
  // need to — the action is the same either way.
  if (m.includes('token has expired') || m.includes('invalid token')) {
    return 'That code is wrong or has expired. Ask for a new one.';
  }
  if (m.includes('otp_expired')) return 'That code has expired. Ask for a new one.';
  // Reachable only from the reset flow, and worth its own wording: the update
  // did not fail, it was refused because nothing would change.
  if (m.includes('should be different') || m.includes('same_password')) {
    return 'That is the password you already have. Pick a different one.';
  }
  return message;
}

export const useAuth = create<AuthState>((set, get) => ({
  status: 'loading',
  session: null,
  user: null,
  error: null,
  busy: false,
  pendingConfirmation: null,
  recovery: null,
  authInitialScreen: 'sign-in',
  setAuthInitialScreen: (screen) => set({ authInitialScreen: screen }),
  tourExitScreen: null,
  setTourExitScreen: (screen) => set({ tourExitScreen: screen }),

  init: () => {
    // Unconditional, and deliberately not awaited. Builds up to 16 Aug 2026
    // wrote the account password to AsyncStorage in clear text; shipping the
    // fix does nothing for the handsets that already have the file, so every
    // launch deletes it — along with the refresh token the attempt after that
    // one left behind. See `services/biometrics.ts`.
    void purgeLegacyCredentials();

    // With no project configured there is nothing to sign in to, so the app
    // runs signed-out against seeded data rather than blocking on a backend
    // that does not exist.
    if (!supabase) {
      set({ status: 'signed-out' });
      return;
    }

    supabase.auth
      .getSession()
      .then(async ({ data }) => {
        const user = data.session?.user ?? null;
        if (user) {
          const remote = await db.fetchAlgoState(user.id);
          if (remote) {
            const { useVybe } = await import('@/store/useVybe');
            useVybe.setState({
              onboarded: true,
              onboardedFor: user.id,
              algo: remote.algo,
              algoSyncedAt: remote.updatedAt,
            });
          }
        }
        set({
          session: data.session,
          user,
          status: data.session ? 'signed-in' : 'signed-out',
        });
      })
      // Routing blocks while `status` is 'loading', so this has to resolve
      // even when the session store cannot be read. Someone who is actually
      // signed in gets picked up by `onAuthStateChange` a moment later.
      .catch(() => set({ status: 'signed-out' }));

    // Covers token refreshes and sign-out from any other call site, so the
    // store never drifts from what the SDK actually holds.
    supabase.auth.onAuthStateChange((_event, session) => {
      set({
        session,
        user: session?.user ?? null,
        status: session ? 'signed-in' : 'signed-out',
      });
    });
  },

  signUp: async (email, password, name) => {
    if (!supabase) {
      set({ error: 'Supabase is not configured. Add your keys to .env.' });
      return false;
    }
    set({ busy: true, error: null, pendingConfirmation: null });

    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { display_name: name.trim() } },
    });

    if (error) {
      set({ busy: false, error: readable(error.message) });
      return false;
    }

    // No session means the project has email confirmation on and Supabase has
    // just sent a six-digit code. Not a failure — the next step is the verify
    // screen, which the pending address routes to.
    if (!data.session) {
      set({ busy: false, pendingConfirmation: email.trim() });
      return false;
    }

    set({ busy: false, session: data.session, user: data.user, status: 'signed-in' });
    return true;
  },

  signIn: async (email, password) => {
    if (!supabase) {
      set({ error: 'Supabase is not configured. Add your keys to .env.' });
      return false;
    }
    set({ busy: true, error: null, pendingConfirmation: null });

    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (error) {
      // An account that was created but never confirmed cannot sign in and has
      // no code left to type — the first one expired or was never used. Send a
      // fresh one and route to verification rather than leaving them at a wall.
      if (error.message.toLowerCase().includes('email not confirmed')) {
        void supabase.auth.resend({ type: 'signup', email: email.trim() });
        set({ busy: false, error: null, pendingConfirmation: email.trim() });
        haptic('warning');
        return false;
      }
      set({ busy: false, error: readable(error.message) });
      haptic('warning');
      return false;
    }

    // Nothing is saved for biometrics here. The sign-in screen asks first —
    // see `enableBiometricSignIn`.

    // Check if the user already has an algorithm configured in the DB
    if (data.user?.id) {
      const remote = await db.fetchAlgoState(data.user.id);
      if (remote) {
        const { useVybe } = await import('@/store/useVybe');
        useVybe.setState({
          onboarded: true,
          onboardedFor: data.user.id,
          algo: remote.algo,
          algoSyncedAt: remote.updatedAt,
        });
      }
    }

    haptic('success');
    set({ busy: false, session: data.session, user: data.user, status: 'signed-in' });
    return true;
  },

  signInWithBiometrics: async () => {
    if (!supabase) {
      set({ error: 'Supabase is not configured. Add your keys to .env.' });
      return false;
    }

    const { biometryType } = await checkBiometricsSupport();

    // The prompt happens inside this call and the credentials are only returned
    // on success, so there is no path where a refused check still hands the
    // caller something to sign in with.
    const unlocked = await unlockRememberedCredentials(biometryType);

    if (unlocked.status !== 'ok') {
      haptic('warning');
      // Each outcome gets the message that matches it. These were one branch,
      // which meant a failed *scan* told the user to sign in with a password —
      // advice that could not help, because the saved credential was fine and
      // signing in again just re-saved it.
      set({
        error:
          unlocked.status === 'no-credential'
            ? `Sign in with your password once and ${biometryType} will work from then on.`
            : unlocked.status === 'unavailable'
              ? `${biometryType} is not set up on this device. Add it in your device settings, or sign in with your password.`
              : // 'rejected' — a bad scan or Cancel. Nothing is broken and there
                // is nothing to fix, so the message says only what happened.
                `${biometryType} did not match. Try again, or use your password.`,
      });
      return false;
    }

    // An ordinary password sign-in, which is the whole point: it opens a fresh
    // session rather than resuming one, so it does not care that the last one
    // was signed out of. `signIn` also carries the algo fetch, the pending-
    // confirmation branch and the error translation, none of which should exist
    // twice.
    const ok = await get().signIn(unlocked.email, unlocked.password);
    if (ok) return true;

    // The stored password no longer opens the account — it was changed, or the
    // account is gone. Keeping it means a button that fails forever, so it goes
    // and the password field takes over. A pending confirmation is *not* that:
    // the credentials are fine and the user is being sent to the verify screen.
    if (!get().pendingConfirmation) {
      await clearBiometricCredentials();
      set({
        error: `That saved sign-in no longer works — your password may have changed. Sign in with it once to set ${biometryType} up again.`,
      });
    }
    return false;
  },

  enableBiometricSignIn: async (email, password) => {
    const { supported, enrolled } = await checkBiometricsSupport();
    if (!supported || !enrolled) return false;
    return rememberCredentials(email, password);
  },

  verifyOtp: async (token) => {
    const email = get().pendingConfirmation;
    if (!supabase || !email) {
      set({ error: 'There is nothing waiting to be verified.' });
      haptic('warning');
      return false;
    }
    set({ busy: true, error: null });

    const { data, error } = await supabase.auth.verifyOtp({
      email,
      token: token.trim(),
      type: 'signup',
    });

    if (error) {
      set({ busy: false, error: readable(error.message) });
      haptic('warning');
      return false;
    }

    haptic('success');
    // Clearing the pending address is what closes the verify screen's guard.
    set({
      busy: false,
      pendingConfirmation: null,
      session: data.session,
      user: data.user,
      status: data.session ? 'signed-in' : 'signed-out',
    });
    return true;
  },

  resendOtp: async () => {
    const email = get().pendingConfirmation;
    if (!supabase || !email) return false;
    set({ busy: true, error: null });

    const { error } = await supabase.auth.resend({ type: 'signup', email });
    if (error) {
      // Supabase rate-limits resends and says so precisely ("you can only
      // request this after 51 seconds"), which is more use than anything a
      // translation here would say.
      set({ busy: false, error: readable(error.message) });
      return false;
    }

    set({ busy: false });
    return true;
  },

  requestPasswordReset: async (email) => {
    if (!supabase) {
      set({ error: 'Supabase is not configured. Add your keys to .env.' });
      return false;
    }
    set({ busy: true, error: null });

    const address = email.trim();
    const { error } = await supabase.auth.resetPasswordForEmail(address);

    // Only transport failures surface. Supabase answers the same way whether or
    // not the address has an account, and that is the behaviour to preserve —
    // telling somebody "no account with that email" from an unauthenticated
    // screen turns the form into a way of testing which addresses are members.
    // So does opening the flow for one address and not the other, which is why
    // the code screen follows either way.
    if (error) {
      set({ busy: false, error: readable(error.message) });
      haptic('warning');
      return false;
    }

    haptic('success');
    set({ busy: false, recovery: { email: address, verified: false } });
    return true;
  },

  resendRecoveryCode: async () => {
    const recovery = get().recovery;
    if (!supabase || !recovery) return false;
    set({ busy: true, error: null });

    const { error } = await supabase.auth.resetPasswordForEmail(recovery.email);
    if (error) {
      // Same as `resendOtp`: the rate-limit message names the wait in seconds,
      // which is more use than anything a translation would say.
      set({ busy: false, error: readable(error.message) });
      return false;
    }

    set({ busy: false });
    return true;
  },

  verifyRecoveryCode: async (token) => {
    const recovery = get().recovery;
    if (!supabase || !recovery) {
      set({ error: 'There is no password reset in progress.' });
      haptic('warning');
      return false;
    }
    set({ busy: true, error: null });

    const { data, error } = await supabase.auth.verifyOtp({
      email: recovery.email,
      token: token.trim(),
      type: 'recovery',
    });

    if (error) {
      set({ busy: false, error: readable(error.message) });
      haptic('warning');
      return false;
    }

    haptic('success');
    // The session this opens is what makes `updateUser` below possible — it is
    // the proof of ownership, and there is no other way to change a password
    // nobody can remember. `recovery` staying set is what stops the root layout
    // acting on the sign-in that just implicitly happened.
    set({
      busy: false,
      session: data.session,
      user: data.user,
      recovery: { ...recovery, verified: true },
    });
    return true;
  },

  setNewPassword: async (password) => {
    if (!supabase || !get().recovery?.verified) {
      set({ error: 'There is no password reset in progress.' });
      return false;
    }
    set({ busy: true, error: null });

    const { data, error } = await supabase.auth.updateUser({ password });
    if (error) {
      set({ busy: false, error: readable(error.message) });
      haptic('warning');
      return false;
    }

    // Whatever is in the Keychain is the *old* password, so the biometric
    // button would now fail on every press and then delete itself. Clearing it
    // here means the next password sign-in offers to set it up again, which is
    // the same place somebody who had never turned it on starts from.
    await clearBiometricCredentials();

    // Setup state belongs to the account and this is a session for an account
    // that was already set up, so the same fetch sign-in does has to happen
    // here — otherwise finishing a reset drops the user into onboarding.
    if (data.user?.id) {
      const remote = await db.fetchAlgoState(data.user.id);
      if (remote) {
        const { useVybe } = await import('@/store/useVybe');
        useVybe.setState({
          onboarded: true,
          onboardedFor: data.user.id,
          algo: remote.algo,
          algoSyncedAt: remote.updatedAt,
        });
      }
    }

    haptic('success');
    // Clearing `recovery` opens the account gate, and the session opened by the
    // code carries them through it — a reset ends signed in, because asking
    // somebody to type the password they set ten seconds ago proves nothing.
    set({ busy: false, recovery: null, user: data.user, status: 'signed-in' });
    return true;
  },

  cancelRecovery: async () => {
    // A verified code left a real session behind. Backing out of the flow has
    // to end it, or "cancel" would quietly leave the account open on the phone
    // to somebody who never entered a password.
    if (get().recovery?.verified) {
      await supabase?.auth.signOut({ scope: 'local' }).catch(() => {});
    }
    set({ recovery: null, error: null, status: 'signed-out', session: null, user: null });
  },

  signOut: async () => {
    // Local scope: this device's session ends and nobody else's does. A global
    // sign-out here would also kill the user's other handsets, which nobody
    // asks for by tapping "sign out" on one of them.
    //
    // The saved biometric credentials are untouched, and — unlike the refresh
    // token this used to keep — they are not tied to the session GoTrue is
    // about to delete, so biometric sign-in still works straight after this.
    // `forgetDevice` is the one that clears them.
    await supabase?.auth.signOut({ scope: 'local' }).catch(() => {});
    set({
      session: null,
      user: null,
      status: 'signed-out',
      error: null,
      authInitialScreen: 'sign-in',
      tourExitScreen: null,
      recovery: null,
    });

    // Imported lazily: useVybe imports this module, so a top-level import here
    // would close the circle. Everything belonging to the account that just
    // left has to go, or the next person to sign in on this phone sees it.
    const { useVybe } = await import('@/store/useVybe');
    useVybe.getState().clearAccountState();
  },

  forgetDevice: async () => {
    // Global first, so the token is dead server-side even if the local clear
    // fails — the ordering is the difference between "revoked" and "hopefully
    // deleted".
    await supabase?.auth.signOut({ scope: 'global' }).catch(() => {});
    await clearBiometricCredentials();
    set({
      session: null,
      user: null,
      status: 'signed-out',
      error: null,
      authInitialScreen: 'sign-in',
      tourExitScreen: null,
      recovery: null,
    });
    const { useVybe } = await import('@/store/useVybe');
    useVybe.getState().clearAccountState();
  },

  clearError: () => set({ error: null }),
  cancelConfirmation: () => set({ pendingConfirmation: null, error: null }),
}));

export { isConfigured };

/** Display name, falling back through metadata to the email local part. */
export function displayName(user: User | null): string {
  if (!user) return 'You';
  const meta = user.user_metadata as { display_name?: string } | undefined;
  return meta?.display_name?.trim() || user.email?.split('@')[0] || 'You';
}
