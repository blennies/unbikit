/**
 * Worker thread
 */
import {
  type BikAudioTrackHeader,
  type BikDecoder,
  createBikDecoder,
} from "../../../src/bik-decoder.ts";

let offscreenCanvas: OffscreenCanvas | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;
let audioWorkletPort: MessagePort | null = null;
let decoder: BikDecoder | null = null;
let imageData: ImageData | null = null;
let playing: boolean = false;
let startTime: number | null = null;
let currentFrame = 0;
let framesPlayed = 0;
let nextPlayLoopTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Single-function converter of YUV420p to RGBA (no alpha plane input support)
 */
const yuv420PlanarToRgb = (
  yuv: Uint8Array,
  rgba: ImageDataArray | Uint8Array,
  width: number,
  height: number,
): void => {
  const frameSize = width * height;
  const halfWidth = width >>> 1;
  const uStart = frameSize;
  const vStart = frameSize + ((width + 1) >>> 1) * ((height + 1) >>> 1);
  let rgbaPtr = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const yy = yuv[y * width + x] ?? 0;
      const colorIndex = (y >>> 1) * halfWidth + (x >>> 1);
      const uu = (yuv[uStart + colorIndex] ?? 0) - 128;
      const vv = (yuv[vStart + colorIndex] ?? 0) - 128;

      const r = yy + 1.402 * vv;
      const g = yy - 0.344 * uu - 0.714 * vv;
      const b = yy + 1.772 * uu;

      rgba[rgbaPtr++] = r;
      rgba[rgbaPtr++] = g;
      rgba[rgbaPtr++] = b;
      rgba[rgbaPtr++] = 255;
    }
  }
};

/**
 * Handles messages sent to this thread.
 * @param evt
 */
globalThis.onmessage = async (evt) => {
  const type: string = evt.data.type;
  const payload = evt.data.payload;

  switch (type) {
    case "canvas": {
      offscreenCanvas = payload;
      ctx = offscreenCanvas?.getContext("2d") ?? null;
      break;
    }
    // case "setCanvasSize": {
    //   if (offscreenCanvas) {
    //     offscreenCanvas.width = payload.width;
    //     offscreenCanvas.height = payload.height;
    //   }
    //   break;
    // }
    case "transferAudioWorkletPort": {
      audioWorkletPort = payload;
      updateUI();
      break;
    }
    case "decodeNewFile": {
      if (offscreenCanvas && payload) {
        const videoSrc = payload;
        if (nextPlayLoopTimer) {
          clearTimeout(nextPlayLoopTimer);
          nextPlayLoopTimer = null;
        }
        const dataSource =
          typeof videoSrc === "string" ? new URL(videoSrc, location.origin) : (videoSrc as File);
        decoder = await createBikDecoder(dataSource);

        const videoWidth = decoder.header?.width ?? 100;
        const videoHeight = decoder.header?.height ?? 100;
        offscreenCanvas.width = videoWidth;
        offscreenCanvas.height = videoHeight;
        imageData = null;
        playing = false;
        currentFrame = 0;
        framesPlayed = 0;
        postMessage({
          type: "setSampleRate",
          payload: {
            sampleRate: decoder?.header?.audioTracks?.[0]?.sampleRate ?? null,
            videoAspectRatio: videoWidth / videoHeight,
          },
        });
        audioWorkletPort?.postMessage({
          type: "discardAudioPackets",
          payload: null,
        });
      }
      break;
    }
    case "play": {
      playing = true;
      startTime = null;
      framesPlayed = 0;
      playLoop();
      break;
    }
    case "stop": {
      playing = false;
      currentFrame = 0;
      framesPlayed = 0;
      ctx?.reset();
      audioWorkletPort?.postMessage({
        type: "discardAudioPackets",
        payload: null,
      });
      decoder?.reset();
      ctx?.reset();
      imageData = null;
      updateUI();
      break;
    }
    default:
      break;
  }
};

async function playLoop() {
  if (!playing || !ctx || !decoder) {
    return;
  }
  if (imageData) {
    ctx.putImageData(imageData, 0, 0);
  }
  try {
    const packet = await decoder?.getNextFrame();

    if (!packet) {
      playing = false;
      return;
    }

    if (packet.videoFrame) {
      const frame = packet.videoFrame;
      if (!imageData) {
        imageData = ctx.createImageData(frame.width, frame.height);
      }

      // Use browser built-in YUV->RGB conversion if it's available.
      if (globalThis.VideoFrame) {
        const videoFrame = new VideoFrame(frame.yuv, {
          format: decoder.header?.videoFlags.hasAlpha ? "I420A" : "I420",
          colorSpace: { primaries: "smpte170m" },
          codedWidth: frame.width,
          codedHeight: frame.height,
          timestamp: 0,
          transfer: [frame.yuv.buffer as ArrayBuffer],
        });
        try {
          await videoFrame.copyTo(imageData.data, {
            format: "RGBA",
            colorSpace: "srgb",
          });
        } catch (_err) {
          // ignore errors
        } finally {
          videoFrame.close();
        }
      } else {
        // Fallback to unoptimized implementation of YUV->RGB with no alpha support.
        yuv420PlanarToRgb(frame.yuv, imageData.data, frame.width, frame.height);
      }
    }

    let track: BikAudioTrackHeader | undefined;
    let channelBuffers: Float32Array[] | undefined;
    let numChannels = 0;
    if (packet.audioTracks?.[0]?.blocks?.length) {
      numChannels = packet.audioTracks[0].header.numChannels;
      const blocks = packet.audioTracks[0].blocks;
      const blocksLen = blocks.reduce((prev, cur) => prev + (cur[0]?.length ?? 0), 0);
      track = decoder?.header?.audioTracks[0];
      if (track && blocksLen > 0) {
        channelBuffers = new Array(numChannels);
        for (const [index] of channelBuffers.entries()) {
          channelBuffers[index] = new Float32Array(blocksLen);
        }
        for (let ch = 0; ch < numChannels; ch++) {
          const channelData = channelBuffers[ch] as Float32Array;
          let offset = 0;
          for (let blockIndex = 0; blockIndex < blocks.length; blockIndex++) {
            const block = blocks[blockIndex]?.[ch];
            if (block) {
              channelData.set(block, offset);
              offset += block.length;
            }
          }
        }
      }
    }

    const frameTime = 1000 / (decoder.header?.fps ?? 30);
    let timeToNextFrame = 0.0;
    if (startTime === null) {
      startTime = performance.now();
    } else {
      const expectedNextFrameTime = frameTime * framesPlayed + startTime;
      timeToNextFrame = Math.max(expectedNextFrameTime - performance.now(), 0.0);
    }
    currentFrame++;
    framesPlayed++;

    if (track && channelBuffers) {
      audioWorkletPort?.postMessage(
        {
          type: "playAudioPacket",
          payload: {
            audioData: channelBuffers,
            numChannels,
            sampleRate: track?.sampleRate,
            trackIndex: 0,
          },
        },
        channelBuffers.map((x) => x.buffer),
      );
    }

    nextPlayLoopTimer = setTimeout(() => {
      if (playing) {
        playLoop();
      }
    }, timeToNextFrame);

    updateUI();
  } catch (err) {
    console.log(err);
  }
}

function updateUI() {
  postMessage({
    type: "updateUI",
    payload: {
      currentFrame,
      totalFrames: decoder?.header?.numFrames ?? 0,
      fps: decoder?.header?.fps.toFixed(2) ?? 0,
    },
  });
}

postMessage({ type: "workerInitDone", payload: null });
