/**
 * Functions and constants that are common across multiple tests/benchmarks.
 */
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import * as path from "node:path/posix";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { PNG } from "pngjs";
import { objectEntries } from "ts-extras";

import { BikDecoder, type BikFrame } from "../src/bik-decoder.ts";

export const ASSET_CACHE_PATH: string = path.join(import.meta.dirname, ".asset-cache");

/**
 * Information about media files that are used as test fixtures. They will be downloaded if they
 * are not already cached.
 */
const MEDIA_SRC_URLS = {
  site01: "https://sembiance.com/fileFormatSamples/video/bink/",
  site02: "https://samples.ffmpeg.org/game-formats/bink/",
  site03: "https://samples.ffmpeg.org/game-formats/bink2/",
} as const;
type MediaSrc = keyof typeof MEDIA_SRC_URLS;

const MEDIA_FILES_INFO = {
  testfile01: {
    filename: "ATI-9700-Animusic-Movie-v1.0.bik",
    site: "site01",
    sha256: "d642466b19d8310a49d7b364fb8a088086e6108647d10a547ec72f595e0097c3",
  },
  testfile02: {
    filename: "OpenPt1.bik",
    site: "site01",
    sha256: "6075bbb808ec14f350fcfadecdcf035ead004262fa47a1d2a26175f85a9e6847",
  },
  testfile03: {
    filename: "end_victory.bik",
    site: "site01",
    sha256: "06fad64ce085a2b4a970d052df05d8f13a526cc08e365b2f6f09227ec0a806c2",
  },
  testfile04: {
    filename: "intro.bik",
    site: "site01",
    sha256: "ca0a13ba6386edc4dcbb360f6e949eb8192b699cbcbd9966dbd314060ef48cba",
  },
  testfile05: {
    filename: "logo_lucas.bik",
    site: "site01",
    sha256: "0afeabdf20b4de3edd71fea8747f8a1cff71ab665ddeccf53e76f59671c42cc1",
  },
  testfile06: {
    filename: "original.bik",
    site: "site01",
    sha256: "1c6318577b57f4ef60c0d861a7c8f4f26fd6e7119a3bdab68ae879062394a3d3",
  },
  testfile07: {
    filename: "phar_intro.bik",
    site: "site01",
    sha256: "c58b6b4cd8afb843e6a004c516e59de100494eafe75a295996af2f29047c4e1b",
  },
  // This test file is BIK 1b format, which we don't support.
  testfile08bk1b: {
    filename: "DEFENDALL.BIK",
    site: "site01",
    sha256: "85f215f72d50c9fb14995707778ef2149a33b197070765cd901edb3e2f2733d7",
  },
  // This test file is BIK 2 format, which we don't support
  testfile09bk2: {
    filename: "Open_Logos_partial.bik",
    site: "site03",
    sha256: "62edb59b3b36f1eb2ddffac39d62ab45cf8f3640f8aac7989882e9d20e911574",
  },
} as const;
type MediaFileIndex = keyof typeof MEDIA_FILES_INFO;
type MediaFileEntry = (typeof MEDIA_FILES_INFO)[MediaFileIndex];

/**
 * Class for managing fetching/reading of a media file.
 */
class MediaFile {
  #name: MediaFileIndex;
  #mediaFileInfo: MediaFileEntry;
  #url: string;

  static #mediaFileVerified: Partial<Record<MediaFileIndex, boolean>> = {};

  constructor(fileIndex: MediaFileIndex, site: MediaSrc) {
    this.#name = fileIndex;
    this.#mediaFileInfo = MEDIA_FILES_INFO[fileIndex];
    this.#url = new URL(this.#mediaFileInfo.filename, MEDIA_SRC_URLS[site]).toString();
  }

  get name(): MediaFileIndex {
    return this.#name;
  }

  get url(): string {
    return this.#url;
  }

  async getData(): Promise<Uint8Array> {
    // Try reading the file from the on-disk cache
    const fileCachePath = path.join(
      ASSET_CACHE_PATH,
      this.#mediaFileInfo.site,
      this.#mediaFileInfo.filename,
    );
    try {
      const fileData = new Uint8Array(await readFile(fileCachePath));
      return fileData;
    } catch (_) {
      // Couldn't read cached file, so try fetching instead
      const response = await fetch(this.#url);
      const fileData = new Uint8Array(await response.arrayBuffer());
      await mkdir(path.dirname(fileCachePath), { recursive: true });
      await writeFile(fileCachePath, fileData);
      return fileData;
    }
  }

  getStreamFn(): (
    offset: number,
    len?: number | undefined, // when undefined, stream until the end of the file
  ) => Promise<ReadableStream<Uint8Array>> {
    return async (offset: number, len?: number | undefined) => {
      let fileStream: ReadableStream<Uint8Array> | undefined;
      const streamOpts: { start?: number; end?: number } = {
        start: offset,
      };
      if (typeof len !== "undefined") {
        streamOpts.end = offset + len;
      }

      // Try reading the file from the on-disk cache
      const fileCachePath = path.join(
        ASSET_CACHE_PATH,
        this.#mediaFileInfo.site,
        `${this.#name}.bik`,
      );
      try {
        if (this.#mediaFileInfo.sha256 && !MediaFile.#mediaFileVerified[this.#name]) {
          const hash = createHash("sha256");
          hash.setEncoding("hex");
          await pipeline(createReadStream(fileCachePath), hash);
          const fileHash: string = hash.read();
          if (fileHash !== this.#mediaFileInfo.sha256) {
            throw new Error(
              `SHA-256 mismatch for ${this.#name}: expected ${this.#mediaFileInfo.sha256} but got ${fileHash}`,
            );
          }
          MediaFile.#mediaFileVerified[this.#name] = true;
        }
        fileStream = Readable.toWeb(
          createReadStream(fileCachePath, streamOpts),
        ) as ReadableStream<Uint8Array>;
      } catch (_) {
        // Couldn't read cached file, so try fetching instead
        const response = await fetch(this.#url);
        const fileData = new Uint8Array(await response.arrayBuffer());
        await mkdir(path.dirname(fileCachePath), { recursive: true });
        await writeFile(fileCachePath, fileData);

        if (this.#mediaFileInfo.sha256 && !MediaFile.#mediaFileVerified[this.#name]) {
          const hash = createHash("sha256");
          hash.setEncoding("hex");
          await pipeline(createReadStream(fileCachePath), hash);
          const fileHash: string = hash.read();
          if (fileHash !== this.#mediaFileInfo.sha256) {
            throw new Error(
              `SHA-256 mismatch for fetched file ${this.#name}: expected ${this.#mediaFileInfo.sha256} but got ${fileHash}`,
            );
          }
          MediaFile.#mediaFileVerified[this.#name] = true;
        }
        fileStream = Readable.toWeb(
          createReadStream(fileCachePath, streamOpts),
        ) as ReadableStream<Uint8Array>;
      }
      return fileStream;
    };
  }
}

const tmpMediaFiles: Partial<Record<MediaFileIndex, MediaFile>> = {};
for (const [fileIndex, fileInfo] of objectEntries(MEDIA_FILES_INFO)) {
  tmpMediaFiles[fileIndex] = new MediaFile(fileIndex, fileInfo.site);
}

/**
 * Mapping from media file index to a {@link MediaFile} instance that can be used to access the
 * media file data.
 */
const mediaFiles = tmpMediaFiles as Record<MediaFileIndex, MediaFile>;

/**
 * Get a new instance of the BIK decoder for a given media file.
 * @param file Media file to pass to the new decoder instance.
 * @returns New decoder instance.
 */
const getMediaFileDecoder = async (file: MediaFile): Promise<BikDecoder> => {
  return await BikDecoder.open(file.getStreamFn());
};

/**
 * Generate a SHA-256 digest (256-bit hash).
 * @param data Data to generate a SHA-256 digest from.
 * @returns The generated digest as a hex string.
 */
const getShaSum = async (
  data: Uint8Array<ArrayBuffer> | undefined | null,
): Promise<string | null> => {
  if (!data) {
    return null;
  }
  return Buffer.from(await crypto.subtle.digest("SHA-256", data)).toString("hex");
};

/**
 * Convert a YUV420P frame to an RGBA frame.
 * @param yuv YUV420P image data.
 * @param width Width of the image in pixels.
 * @param height Height of the image in pixels.
 * @returns RGBA image data.
 */
const yuv420PlanarToRgb = (yuv: Uint8Array, width: number, height: number): Uint8ClampedArray => {
  const frameSize = width * height;
  const halfWidth = width >>> 1;
  const uStart = frameSize;
  const vStart = frameSize + ((width + 1) >>> 1) * ((height + 1) >>> 1);
  const rgba = new Uint8ClampedArray(frameSize << 2);
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

  return rgba;
};

const frameToPng = (frame: BikFrame | null | undefined): Uint8Array<ArrayBuffer> | undefined => {
  const videoFrame = frame?.videoFrame;
  if (!videoFrame) {
    return;
  }
  const rgba = yuv420PlanarToRgb(videoFrame.yuv, videoFrame.width, videoFrame.height);
  const png = new PNG({
    width: videoFrame.width,
    height: videoFrame.height,
    inputHasAlpha: true,
  });
  png.data.set(rgba);
  return new Uint8Array(PNG.sync.write(png));
};

export {
  frameToPng,
  getMediaFileDecoder,
  getShaSum,
  yuv420PlanarToRgb,
  mediaFiles,
  type MediaFile,
};
