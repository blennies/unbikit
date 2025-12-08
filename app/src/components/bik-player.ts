import audioWorkletUrl from "./bik-player-audioworklet.ts?worker&url";

export interface BikPlayerOptions {
  canvas: HTMLCanvasElement;
  onAspectRatioSet?: ((ratio: number) => void) | null | undefined;
  onUpdateUI?:
    | ((info: { currentFrame: number; totalFrames: number; fps: number }) => void)
    | null
    | undefined;
}

async function sleep(duration: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, duration));
}

// Player implementation
export class BikPlayer {
  offscreenCanvas: OffscreenCanvas;
  onUpdateUI: ((info: { currentFrame: number; totalFrames: number; fps: number }) => void) | null;
  onAspectRatioSet: ((ratio: number) => void) | null;
  worker: Worker;
  playing = false;
  currentFrame = 0;
  totalFrames = 0;
  audioContext: AudioContext | null = null;
  gainNode: GainNode | null = null;

  constructor(opts: BikPlayerOptions) {
    const offscreenCanvas = opts.canvas.transferControlToOffscreen();
    if (!offscreenCanvas) {
      throw new Error("Failed to get canvas for video player");
    }
    this.offscreenCanvas = offscreenCanvas;
    this.onUpdateUI = opts.onUpdateUI ?? null;
    this.onAspectRatioSet = opts.onAspectRatioSet ?? null;

    this.worker = new Worker(new URL("./bik-player-worker.ts", import.meta.url), {
      type: "module",
    });
    this.worker.onmessage = async (evt) => {
      const type: string = evt.data.type;
      const payload = evt.data.payload;

      switch (type) {
        case "workerInitDone": {
          this.worker.postMessage({ type: "canvas", payload: this.offscreenCanvas }, [
            this.offscreenCanvas,
          ]);
          break;
        }

        case "updateUI": {
          this.onUpdateUI?.(payload);
          break;
        }

        case "setSampleRate": {
          const sampleRate: number | null = payload.sampleRate;
          const videoAspectRatio: number = payload.videoAspectRatio;
          this.onAspectRatioSet?.(videoAspectRatio);

          if (
            !this.audioContext ||
            (sampleRate !== null && sampleRate !== this.audioContext.sampleRate)
          ) {
            await this.audioContext?.close();
            const opts: AudioContextOptions = {};
            if (sampleRate !== null) {
              opts.sampleRate = sampleRate;
            }
            this.audioContext = new AudioContext(opts);
          }

          await this.audioContext.audioWorklet.addModule(audioWorkletUrl);
          const audioWorkletNode = new AudioWorkletNode(this.audioContext, "bik-audio-processor", {
            channelCount: this.audioContext.destination.channelCount,
            channelCountMode: this.audioContext.destination.channelCountMode,
            channelInterpretation: this.audioContext.destination.channelInterpretation,
          });
          this.gainNode = this.audioContext.createGain();
          audioWorkletNode.connect(this.gainNode);
          this.gainNode.connect(this.audioContext.destination);
          this.worker.postMessage(
            { type: "transferAudioWorkletPort", payload: audioWorkletNode.port },
            [audioWorkletNode.port],
          );
          await this.audioContext.resume();
          break;
        }

        case "play":
          await this.play();
          break;

        default:
          break;
      }
    };
  }

  async loadFile(file: string | File): Promise<void> {
    try {
      this.worker.postMessage({
        type: "decodeNewFile",
        payload: file,
      });
    } catch (err) {
      console.trace(err);
    }
  }

  async play(): Promise<void> {
    if (this.playing) return;

    this.playing = true;
    if (this.audioContext) {
      if (this.audioContext.state === "suspended") {
        await this.audioContext.resume();
      }
      if (this.gainNode) {
        // Fade in audio rapidly to prevent possible "clicking"
        this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, this.audioContext.currentTime);
        this.gainNode.gain.exponentialRampToValueAtTime(1.0, this.audioContext.currentTime + 0.03);
        await sleep(0.03);
      }
      // this.nextAudioTime = this.audioContext.currentTime;
    }
    this.worker.postMessage({ type: "play", payload: null });
  }

  async stop(): Promise<void> {
    this.playing = false;
    if (this.audioContext && this.gainNode) {
      // Fade out audio rapidly to avoid "clicking"
      this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, this.audioContext.currentTime);
      this.gainNode.gain.exponentialRampToValueAtTime(
        0.0001,
        this.audioContext.currentTime + 0.03,
      );
      await sleep(0.03);
    }
    this.worker.postMessage({ type: "stop", payload: null });
  }
}
