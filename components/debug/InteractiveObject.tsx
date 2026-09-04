/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useState, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { mapHandToWorld } from '../../hooks/useMediaPipe';

interface InteractiveObjectProps {
  resultsRef: React.MutableRefObject<any>;
}

export const InteractiveObject: React.FC<InteractiveObjectProps> = ({ resultsRef }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const [isGrabbed, setIsGrabbed] = useState(false);
  const [isMouseDragging, setIsMouseDragging] = useState(false);

  // Default to upper-left corner and compact scale
  const position = useRef(new THREE.Vector3(-1.8, 2.2, 2));
  const rotation = useRef(new THREE.Quaternion());

  const vec3 = useMemo(() => new THREE.Vector3(), []);
  const dummyObj = useMemo(() => new THREE.Object3D(), []);

  const { mouse, viewport } = useThree();

  useFrame(() => {
    if (!meshRef.current) return;

    // 1. Mouse Interaction
    if (isMouseDragging) {
      const x = (mouse.x * viewport.width) / 2;
      const y = (mouse.y * viewport.height) / 2;
      position.current.set(x, y, 2);

      const q = new THREE.Quaternion();
      q.setFromAxisAngle(new THREE.Vector3(1, 1, 0).normalize(), performance.now() / 1000);
      rotation.current.slerp(q, 0.1);
    }

    // 2. Hand Pinch & Grab Interaction
    if (!isMouseDragging && resultsRef.current?.landmarks?.length > 0) {
      const landmarks = resultsRef.current.landmarks[0];
      if (landmarks && landmarks.length >= 18) {
        const thumb = mapHandToWorld(landmarks[4].x, landmarks[4].y);
        const index = mapHandToWorld(landmarks[8].x, landmarks[8].y);

        const pinchDist = thumb.distanceTo(index);
        const handCenter = thumb.clone().add(index).multiplyScalar(0.5);

        const GRAB_THRESHOLD = 0.55;
        const PROXIMITY_THRESHOLD = 1.5;
        const distToObject = handCenter.distanceTo(position.current);

        const isPinching = pinchDist < GRAB_THRESHOLD;

        if (isPinching && (distToObject < PROXIMITY_THRESHOLD || isGrabbed)) {
          setIsGrabbed(true);
          position.current.lerp(handCenter, 0.2);

          const p0 = mapHandToWorld(landmarks[0].x, landmarks[0].y);
          const p5 = mapHandToWorld(landmarks[5].x, landmarks[5].y);
          const p17 = mapHandToWorld(landmarks[17].x, landmarks[17].y);

          const vA = new THREE.Vector3().subVectors(p5, p0).normalize();
          const vB = new THREE.Vector3().subVectors(p17, p0).normalize();
          const vNormal = new THREE.Vector3().crossVectors(vA, vB).normalize();
          const vUp = new THREE.Vector3().crossVectors(vNormal, vA).normalize().negate();

          dummyObj.matrix.makeBasis(vA, vNormal, vUp);
          dummyObj.matrix.decompose(vec3, dummyObj.quaternion, vec3);

          rotation.current.slerp(dummyObj.quaternion, 0.2);
        } else {
          setIsGrabbed(false);
        }
      }
    }

    meshRef.current.position.lerp(position.current, 0.2);
    meshRef.current.quaternion.slerp(rotation.current, 0.2);

    const active = isGrabbed || isMouseDragging;
    const material = meshRef.current.material as THREE.MeshStandardMaterial;
    if (material && material.color) {
      // Technical NASA palette: Vermilion when grabbed/manipulated, technical dark slate when docked
      material.color.set(active ? '#EE3B2B' : '#4B5563');
      material.emissive.set(active ? '#EE3B2B' : '#111827');
      material.emissiveIntensity = active ? 0.9 : 0.2;
    }
  });

  return (
    <mesh
      ref={meshRef}
      scale={[0.55, 0.55, 0.55]}
      onPointerDown={(e) => {
        e.stopPropagation();
        setIsMouseDragging(true);
      }}
      onPointerUp={(e) => {
        e.stopPropagation();
        setIsMouseDragging(false);
      }}
      onPointerLeave={() => setIsMouseDragging(false)}
    >
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial
        color="#4B5563"
        wireframe={false}
        transparent
        opacity={0.85}
        roughness={0.2}
        metalness={0.7}
      />
      <mesh scale={[1.04, 1.04, 1.04]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial color="#FFFFFF" wireframe transparent opacity={0.4} />
      </mesh>
    </mesh>
  );
};

export default InteractiveObject;
