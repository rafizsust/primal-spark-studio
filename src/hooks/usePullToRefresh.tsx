import { useState, useRef, useCallback, useEffect } from 'react';

interface PullToRefreshConfig {
  onRefresh: () => Promise<void>;
  threshold?: number;
  disabled?: boolean;
}

export function usePullToRefresh({ 
  onRefresh, 
  threshold = 80,
  disabled = false 
}: PullToRefreshConfig) {
  const [isPulling, setIsPulling] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const startY = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (disabled || isRefreshing) return;
    
    // Only enable pull-to-refresh when scrolled to top
    const scrollTop = containerRef.current?.scrollTop ?? 0;
    if (scrollTop > 0) return;
    
    startY.current = e.touches[0].clientY;
    setIsPulling(true);
  }, [disabled, isRefreshing]);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isPulling || startY.current === null || disabled || isRefreshing) return;
    
    const currentY = e.touches[0].clientY;
    const diff = currentY - startY.current;
    
    // Only allow pulling down
    if (diff > 0) {
      // Apply resistance to make it feel more natural
      const resistance = 0.5;
      setPullDistance(Math.min(diff * resistance, threshold * 1.5));
    }
  }, [isPulling, threshold, disabled, isRefreshing]);

  const onTouchEnd = useCallback(async () => {
    if (!isPulling || disabled) return;
    
    if (pullDistance >= threshold && !isRefreshing) {
      setIsRefreshing(true);
      try {
        await onRefresh();
      } finally {
        setIsRefreshing(false);
      }
    }
    
    setIsPulling(false);
    setPullDistance(0);
    startY.current = null;
  }, [isPulling, pullDistance, threshold, onRefresh, isRefreshing, disabled]);

  // Reset on unmount
  useEffect(() => {
    return () => {
      setIsPulling(false);
      setPullDistance(0);
      setIsRefreshing(false);
    };
  }, []);

  const progress = Math.min(pullDistance / threshold, 1);

  return {
    containerRef,
    pullHandlers: {
      onTouchStart,
      onTouchMove,
      onTouchEnd,
    },
    isPulling,
    isRefreshing,
    pullDistance,
    progress,
  };
}
