/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { handRig, handRigFromScenePoints } from './handRig';
import { fitProjection, toScene } from './projection';

describe('handRigFromScenePoints', () => {
  it('handRig is the same rig over toScene points', () => {
    const p = fitProjection(1000, 1000, 1);
    const lm = Array.from({ length: 21 }, (_, i) => ({ x: 0.3 + i * 0.01, y: 0.4 + (i % 5) * 0.02, z: -0.01 * i }));
    expect(handRigFromScenePoints(lm.map((l) => toScene(l, p)))).toEqual(handRig(lm, p));
  });
});
