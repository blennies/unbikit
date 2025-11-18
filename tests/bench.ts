/**
 * Benchmark of the decoding of sample `.bik` video sequences.
 *
 * Run with:
 *   `pnpm bench`
 *
 * DO NOT run with `vitest bench`.
 */
import { bench, run } from "mitata";

import { BikDecoder } from "../dist/unbikit.js";
import { type MediaFile, mediaFiles } from "./common.ts";

const COMPACT_RESULTS = false;
const TEST_MEDIA_FILES = [
  "testfile01",
  "testfile02",
  "testfile03",
  "testfile04",
  "testfile05",
  "testfile06",
  "testfile07",
] as const;

/**
 * Get a new instance of the BIK decoder for a given media file.
 * @param file Media file to pass to the new decoder instance.
 * @returns New decoder instance.
 */
const getMediaFileDecoder = async (file: MediaFile): Promise<BikDecoder> => {
  return await BikDecoder.open(file.getStreamFn());
};

for (const filename of TEST_MEDIA_FILES) {
  bench(`decode a frame from "${filename}"`, async function* () {
    yield {
      async [0](): Promise<BikDecoder> {
        const decoder = (await getMediaFileDecoder(mediaFiles[filename])) as unknown as BikDecoder;

        return decoder;
      },
      async bench(decoder: BikDecoder) {
        let frame = await decoder.getNextFrame();
        if (!frame) {
          await decoder.reset();
          frame = await decoder.getNextFrame();
          if (!frame) {
            throw new Error("Failed to reset decoder");
          }
        }
        return frame;
      },
    };
  })
    .gc("inner")
    .compact(COMPACT_RESULTS);
}

await run({
  throw: true,
  format: "mitata",
});
