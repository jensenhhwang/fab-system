"use client";

import { useEffect, useRef, forwardRef } from "react";
import { CameraControls } from "@react-three/drei";

type CameraControlsProps = React.ComponentProps<typeof CameraControls>;

/**
 * CameraControls 드롭인 대체 컴포넌트.
 * 새 3D 씬에서는 `<CameraControls>` 대신 이걸 쓰면
 * 항상 일관된 조작 방식이 자동 적용됨 — hook 호출 불필요.
 *
 * 조작 방식:
 *   - 좌클릭 드래그 → 이동 (pan/truck)
 *   - 우클릭 드래그 → 회전 (orbit)
 *   - 한 손가락 터치 → 이동
 *   - 휠              → 줌
 */
const PanCameraControls = forwardRef<
  React.ComponentRef<typeof CameraControls>,
  CameraControlsProps
>(function PanCameraControls(props, externalRef) {
  const internalRef = useRef<React.ComponentRef<typeof CameraControls>>(null);

  // external ref 지원 (부모에서 ref가 필요한 경우)
  useEffect(() => {
    if (!externalRef) return;
    if (typeof externalRef === "function") {
      externalRef(internalRef.current);
    } else {
      (externalRef as React.MutableRefObject<React.ComponentRef<typeof CameraControls> | null>).current = internalRef.current;
    }
  });

  useEffect(() => {
    const c = internalRef.current;
    if (!c) return;
    c.mouseButtons.left  = 2;          // ACTION.TRUCK  — 좌클릭 이동
    c.mouseButtons.right = 1;          // ACTION.ROTATE — 우클릭 회전
    c.touches.one        = 0b10000000; // ACTION.TOUCH_TRUCK — 한 손가락 이동
  }, []);

  return <CameraControls ref={internalRef} {...props} />;
});

export default PanCameraControls;
