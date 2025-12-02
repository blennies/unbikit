/**
 * Benchmark (speed test) of the time taken to decode a single frame of a media file.
 *
 * Tests against a selection of media files. The benchmark will cycle repeatedly through all
 * the frames in each video until the benchmark ends.
 */
import { bench, suite } from "vitest";
import { getMediaFileDecoder, mediaFiles } from "./common.ts";

/**
 * Benchmark the time taken to decode a single frame of the specified media file. The benchmark
 * will cycle repeatedly through all the frames in the video until the test ends.
 * @param fileIndex Index name of the media file to use for benchmarking.
 */
const createBench = async (fileIndex: keyof typeof mediaFiles): Promise<void> => {
  const decoder = await getMediaFileDecoder(mediaFiles[fileIndex]);
  bench(
    `decode a frame of ${fileIndex}`,
    async (): Promise<void> => {
      let frame = await decoder.getNextFrame();
      if (!frame) {
        decoder.reset();
        frame = await decoder.getNextFrame();
        if (!frame) {
          throw new Error("Failed to reset decoder");
        }
      }
    },
    {
      async: true,
      iterations: 10000,
      throws: false,
    },
  );
};

suite("benchmark", async () => {
  await createBench("testfile01");
  await createBench("testfile02");
  await createBench("testfile03");
  await createBench("testfile04");
  await createBench("testfile05");
  await createBench("testfile06");
  await createBench("testfile07");
});
