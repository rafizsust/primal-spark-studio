import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Zap, Key } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CreditDisplayProps {
  className?: string;
  compact?: boolean;
  refreshTrigger?: number;
}

interface CreditStatus {
  credits_used: number;
  credits_remaining: number;
  limit: number;
}

export function CreditDisplay({ className, compact = false, refreshTrigger = 0 }: CreditDisplayProps) {
  const { user } = useAuth();
  const [status, setStatus] = useState<CreditStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasUserKey, setHasUserKey] = useState(false);

  useEffect(() => {
    if (user) {
      fetchCreditStatus();
      checkUserKey();
    }
  }, [user, refreshTrigger]);

  const fetchCreditStatus = async () => {
    if (!user) return;
    
    try {
      const { data, error } = await supabase.rpc('get_credit_status', {
        p_user_id: user.id
      });

      if (error) throw error;
      setStatus(data as unknown as CreditStatus);
    } catch (error) {
      console.error('Error fetching credit status:', error);
      // Fallback to default
      setStatus({ credits_used: 0, credits_remaining: 100, limit: 100 });
    } finally {
      setLoading(false);
    }
  };

  const checkUserKey = async () => {
    if (!user) return;
    
    try {
      const { data } = await supabase
        .from('user_secrets')
        .select('id')
        .eq('user_id', user.id)
        .eq('secret_name', 'gemini_api_key')
        .maybeSingle();
      
      setHasUserKey(!!data);
    } catch (error) {
      console.error('Error checking user key:', error);
    }
  };

  if (!user || loading) {
    return null;
  }

  // If user has their own key, show that instead
  if (hasUserKey) {
    return (
      <div className={cn("flex items-center gap-2", className)}>
        <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/30">
          <Key className="w-3 h-3 mr-1" />
          Your API Key
        </Badge>
      </div>
    );
  }

  if (!status) return null;

  const percentUsed = (status.credits_used / status.limit) * 100;
  const isLow = status.credits_remaining <= 20;
  const isCritical = status.credits_remaining <= 5;

  if (compact) {
    return (
      <div className={cn("flex items-center gap-2", className)}>
        <Badge 
          variant="outline" 
          className={cn(
            isCritical ? "bg-destructive/10 text-destructive border-destructive/30" :
            isLow ? "bg-amber-500/10 text-amber-600 border-amber-500/30" :
            "bg-primary/10 text-primary border-primary/30"
          )}
        >
          <Zap className="w-3 h-3 mr-1" />
          {status.credits_remaining}/{status.limit}
        </Badge>
      </div>
    );
  }

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center justify-between text-sm">
        <span className="flex items-center gap-1 text-muted-foreground">
          <Zap className="w-4 h-4" />
          Daily Credits
        </span>
        <span className={cn(
          "font-medium",
          isCritical ? "text-destructive" :
          isLow ? "text-amber-600" :
          "text-foreground"
        )}>
          {status.credits_remaining} / {status.limit} remaining
        </span>
      </div>
      <Progress 
        value={100 - percentUsed} 
        className={cn(
          "h-2",
          isCritical ? "[&>div]:bg-destructive" :
          isLow ? "[&>div]:bg-amber-500" :
          "[&>div]:bg-primary"
        )}
      />
      {isLow && (
        <p className="text-xs text-muted-foreground">
          {isCritical 
            ? "Almost out! Add your own Gemini API key for unlimited use."
            : "Running low. Add your own API key in Settings for unlimited practice."
          }
        </p>
      )}
    </div>
  );
}