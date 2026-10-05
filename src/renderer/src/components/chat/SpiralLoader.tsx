'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { LottieRefCurrentProps } from 'lottie-react';
import Lottie from 'lottie-react';
import { cn } from '@/lib/utils';
import { spiralFastData, spiralSlowData } from './spiral-loader-data';

/** 快速段连续播放几次后切到慢速段 */
const FAST_REPEATS = 4;
const SLOW_REPEATS = 2;

export type SpiralLoaderProps = {
  size?: number;
  className?: string;
};

/** 通过 documentElement 的 .dark 类判断深色模式 */
function useIsDark(): boolean {
  const [isDark, setIsDark] = useState(false);
  useEffect(() => {
    const update = () => setIsDark(document.documentElement.classList.contains('dark'));
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);
  return isDark;
}

export function SpiralLoader({ size = 16, className }: SpiralLoaderProps) {
  const isDark = useIsDark();
  const [phase, setPhase] = useState<'fast' | 'slow'>('fast');
  const repeatCountRef = useRef(0);
  const fastRef = useRef<LottieRefCurrentProps | null>(null);
  const slowRef = useRef<LottieRefCurrentProps | null>(null);

  const startFastPhase = useCallback(() => {
    repeatCountRef.current = 0;
    setPhase('fast');
    slowRef.current?.stop();
    fastRef.current?.goToAndPlay(0, true);
  }, []);

  const startSlowPhase = useCallback(() => {
    repeatCountRef.current = 0;
    setPhase('slow');
    fastRef.current?.stop();
    slowRef.current?.goToAndPlay(0, true);
  }, []);

  const handleFastComplete = useCallback(() => {
    repeatCountRef.current += 1;
    if (repeatCountRef.current < FAST_REPEATS) {
      fastRef.current?.goToAndPlay(0, true);
    } else {
      startSlowPhase();
    }
  }, [startSlowPhase]);

  const handleSlowComplete = useCallback(() => {
    repeatCountRef.current += 1;
    if (repeatCountRef.current < SLOW_REPEATS) {
      slowRef.current?.goToAndPlay(0, true);
    } else {
      startFastPhase();
    }
  }, [startFastPhase]);

  /** Lottie 动画在浅色背景下是黑色，深色背景下需要反色保持可见 */
  const needsInvert = !isDark;

  return (
    <div className={cn('relative shrink-0', className)} style={{ width: size, height: size }}>
      <div
        className={cn(
          'absolute inset-0 transition-opacity duration-75',
          needsInvert && 'invert',
          phase === 'fast' ? 'opacity-100' : 'opacity-0'
        )}
      >
        <Lottie
          lottieRef={fastRef}
          animationData={spiralFastData}
          loop={false}
          autoplay={true}
          onComplete={handleFastComplete}
          style={{ width: '100%', height: '100%' }}
        />
      </div>
      <div
        className={cn(
          'absolute inset-0 transition-opacity duration-75',
          needsInvert && 'invert',
          phase === 'slow' ? 'opacity-100' : 'opacity-0'
        )}
      >
        <Lottie
          lottieRef={slowRef}
          animationData={spiralSlowData}
          loop={false}
          autoplay={false}
          onComplete={handleSlowComplete}
          style={{ width: '100%', height: '100%' }}
        />
      </div>
    </div>
  );
}
