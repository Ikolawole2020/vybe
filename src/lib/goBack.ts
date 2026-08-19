import { router } from 'expo-router';

/**
 * Back, with somewhere to land when there is no back.
 *
 * `router.back()` on the first screen of a stack does nothing and logs *"The
 * action 'GO_BACK' was not handled by any navigator. Is there any screen to go
 * back to?"* — and in production it silently does nothing at all, which is
 * worse: a close button that cannot be pressed.
 *
 * It happens more often than the stack diagram suggests. A push notification
 * deep-links straight into `/post/<id>`; the photo viewer is opened as a
 * full-screen modal and then the post behind it is dismissed; a fast refresh in
 * development remounts the navigator with one entry. In every case the screen
 * is real and the history behind it is not.
 *
 * `canGoBack()` distinguishes the two, and the fallback is the feed — the one
 * route that always exists once someone is signed in. `replace`, not `push`, so
 * the dead-ended screen does not stay on the stack underneath.
 */
export function goBack(fallback: string = '/(tabs)') {
  if (router.canGoBack()) {
    router.back();
    return;
  }
  router.replace(fallback as never);
}
