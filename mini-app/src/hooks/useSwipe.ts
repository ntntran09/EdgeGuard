'use client';

import { useRef, useCallback, useState } from 'react';

interface SwipeState {
  isOpen: boolean;
  offsetX: number;
}

interface UseSwipeOptions {
  threshold?: number;
  maxSwipe?: number;
}

export function useSwipe({ threshold = 60, maxSwipe = 80 }: UseSwipeOptions = {}) {
  const [state, setState] = useState<SwipeState>({ isOpen: false, offsetX: 0 });
  const startXRef = useRef(0);
  const currentXRef = useRef(0);
  const isDraggingRef = useRef(false);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    startXRef.current = e.touches[0].clientX;
    currentXRef.current = e.touches[0].clientX;
    isDraggingRef.current = true;
  }, []);

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!isDraggingRef.current) return;
      currentXRef.current = e.touches[0].clientX;
      const diff = startXRef.current - currentXRef.current;
      
      if (state.isOpen) {
        const newOffset = Math.max(0, Math.min(maxSwipe, maxSwipe + (startXRef.current - currentXRef.current) * -1));
        setState(prev => ({ ...prev, offsetX: newOffset }));
      } else {
        const newOffset = Math.max(0, Math.min(maxSwipe, diff));
        setState(prev => ({ ...prev, offsetX: newOffset }));
      }
    },
    [maxSwipe, state.isOpen]
  );

  const handleTouchEnd = useCallback(() => {
    isDraggingRef.current = false;
    const diff = startXRef.current - currentXRef.current;

    if (state.isOpen) {
      if (diff < -threshold / 2) {
        setState({ isOpen: false, offsetX: 0 });
      } else {
        setState({ isOpen: true, offsetX: maxSwipe });
      }
    } else {
      if (diff > threshold) {
        setState({ isOpen: true, offsetX: maxSwipe });
      } else {
        setState({ isOpen: false, offsetX: 0 });
      }
    }
  }, [threshold, maxSwipe, state.isOpen]);

  const close = useCallback(() => {
    setState({ isOpen: false, offsetX: 0 });
  }, []);

  return {
    isOpen: state.isOpen,
    offsetX: state.offsetX,
    handlers: {
      onTouchStart: handleTouchStart,
      onTouchMove: handleTouchMove,
      onTouchEnd: handleTouchEnd,
    },
    close,
  };
}
