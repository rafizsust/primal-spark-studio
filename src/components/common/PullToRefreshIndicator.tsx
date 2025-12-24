import { RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PullToRefreshIndicatorProps {
  pullDistance: number;
  isRefreshing: boolean;
  progress: number;
  threshold?: number;
}

export function PullToRefreshIndicator({ 
  pullDistance, 
  isRefreshing, 
  progress,
  threshold = 80 
}: PullToRefreshIndicatorProps) {
  if (pullDistance <= 0 && !isRefreshing) return null;

  const opacity = Math.min(progress, 1);
  const rotation = progress * 180;
  const scale = 0.5 + (progress * 0.5);
  const showIndicator = pullDistance > 10 || isRefreshing;

  return (
    <div 
      className={cn(
        "fixed left-1/2 -translate-x-1/2 z-50 transition-all duration-200",
        "flex items-center justify-center",
        showIndicator ? "opacity-100" : "opacity-0"
      )}
      style={{ 
        top: Math.min(pullDistance, threshold * 1.2) + 8,
      }}
    >
      <div 
        className={cn(
          "bg-background border border-border rounded-full p-2 shadow-lg",
          isRefreshing && "animate-pulse"
        )}
        style={{
          opacity: isRefreshing ? 1 : opacity,
          transform: `scale(${isRefreshing ? 1 : scale})`,
        }}
      >
        <RefreshCw 
          className={cn(
            "h-5 w-5 text-primary transition-transform",
            isRefreshing && "animate-spin"
          )}
          style={{
            transform: isRefreshing ? undefined : `rotate(${rotation}deg)`,
          }}
        />
      </div>
    </div>
  );
}
