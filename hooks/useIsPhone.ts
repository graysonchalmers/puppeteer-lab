/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * True below Tailwind's md breakpoint (768px). The exact complement of the
 * md: media query (min-width: 768px), so JS and CSS agree on what "phone"
 * means even at fractional widths.
 */
import { useSyncExternalStore } from 'react';

const QUERY = 'not all and (min-width: 768px)';

const subscribe = (cb: () => void) => {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
};

export function useIsPhone(): boolean {
  return useSyncExternalStore(subscribe, () => window.matchMedia(QUERY).matches, () => false);
}
