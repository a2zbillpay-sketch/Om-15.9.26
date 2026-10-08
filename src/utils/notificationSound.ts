/**
 * Free built-in notification sound using the standard Web Audio API.
 * Synthesizes a warm, pleasant two-tone melodic chime without any external audio files,
 * dependencies, or network latency. Works 100% offline and in all modern browsers/PWAs.
 */

let sharedAudioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtxClass) return null;
    if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
      sharedAudioCtx = new AudioCtxClass();
    }
    return sharedAudioCtx;
  } catch {
    return null;
  }
}

/**
 * Prime/unlock the AudioContext on user interaction so browsers don't block autoplay.
 */
export function unlockAudioContext(): void {
  const ctx = getAudioContext();
  if (ctx && ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }
}

// Auto-register touch/click unlock listeners once
if (typeof window !== 'undefined') {
  const handleInteraction = () => {
    unlockAudioContext();
    window.removeEventListener('pointerdown', handleInteraction);
    window.removeEventListener('keydown', handleInteraction);
  };
  window.addEventListener('pointerdown', handleInteraction, { once: true, passive: true });
  window.addEventListener('keydown', handleInteraction, { once: true, passive: true });
}

/**
 * Play a high-clarity notification chime:
 * Note 1 (D5: 587.33 Hz) -> Note 2 (A5: 880 Hz) with an acoustic bell envelope.
 */
export async function playNotificationSound(): Promise<void> {
  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    if (ctx.state === 'suspended') {
      await ctx.resume().catch(() => {});
    }

    const now = ctx.currentTime;

    // --- First Tone: 587.33 Hz (D5) ---
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(587.33, now);

    gain1.gain.setValueAtTime(0.001, now);
    gain1.gain.exponentialRampToValueAtTime(0.28, now + 0.02);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.22);

    osc1.connect(gain1);
    gain1.connect(ctx.destination);

    osc1.start(now);
    osc1.stop(now + 0.23);

    // --- Second Tone: 880.00 Hz (A5 - High bell chime) ---
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(880.0, now + 0.11);

    gain2.gain.setValueAtTime(0.001, now + 0.11);
    gain2.gain.exponentialRampToValueAtTime(0.35, now + 0.13);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.65);

    osc2.connect(gain2);
    gain2.connect(ctx.destination);

    osc2.start(now + 0.11);
    osc2.stop(now + 0.66);
  } catch (err) {
    console.warn('Web Audio playback notice:', err);
  }
}
