/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * True below Tailwind's md breakpoint (768px). Same boundary as the md:
 * classes, so JS and CSS agree on what "phone" means.
 */
import { useSyncExternalStore } from 'react';

const QUERY = '(max-width: 767px)';

const subscribe = (cb: () => void) => {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
};

export function useIsPhone(): boolean {
  return useSyncExternalStore(subscribe, () => window.matchMedia(QUERY).matches, () => false);
}
