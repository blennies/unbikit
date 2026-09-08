/**
 * Test a set of media files by decoding (most of) the frames in each and outputting screenshots of
 * a small selection of the frames.
 *
 * Test valid BIK 1 (d, f, g, h, i) files that should be decoded correctly, along with valid BIK 1b
 * and 2 files that the decoder should refuse to decode but handle gracefully.
 *
 * Long tests are run as separate test files under the `long-tests` directory, so that they can be
 * run in parallel.
 */

import { suite, test } from "vitest";

import { getMediaFileDecoder, fetchSelectionOfFrames, mediaFiles } from "./common.ts";

suite("decode BIK 1 (d, f, g, h, i) media files", async () => {
  test("should decode frames from across the file (testfile02)", async ({ annotate, expect }) => {
    await fetchSelectionOfFrames("testfile02", { annotate, expect });
  });
  test("should decode frames from across the file (testfile03)", async ({ annotate, expect }) => {
    await fetchSelectionOfFrames("testfile03", { annotate, expect });
  });
  test("should decode frames from across the file (testfile05)", async ({ annotate, expect }) => {
    await fetchSelectionOfFrames("testfile05", { annotate, expect });
  });
  test("should decode frames from across the file (testfile06)", async ({ annotate, expect }) => {
    await fetchSelectionOfFrames("testfile06", { annotate, expect });
  });
});

suite("decode media files of unsupported BIK versions", async () => {
  test("should decode header but refuse to decode BIK 1b frames (testfile08bk1b)", async ({
    annotate,
    expect,
  }) => {
    const decoder = await getMediaFileDecoder(mediaFiles.testfile08bk1b);
    const header = decoder.header;
    await annotate(
      `header info -- version: ${header?.version}${String.fromCharCode(header?.subVersion ?? 63)}, frames: ${header?.numFrames}, image size: ${header?.width}x${header?.height}`,
    );
    expect(header?.version).toEqual(1);
    expect(header?.subVersion).toEqual("b".charCodeAt(0));
    expect(decoder.isSupported).toEqual(false);
    expect(await decoder.getNextFrame()).toBeNull();
    await decoder.skipFrames(1000);
  });

  test("should decode header but refuse to decode BIK 2a frames (testfile09bk2)", async ({
    annotate,
    expect,
  }) => {
    const decoder = await getMediaFileDecoder(mediaFiles.testfile09bk2);
    const header = decoder.header;
    await annotate(
      `header info -- version: ${header?.version}${String.fromCharCode(header?.subVersion ?? 63)}, frames: ${header?.numFrames}, image size: ${header?.width}x${header?.height}`,
    );
    expect(header?.version).toEqual(2);
    expect(header?.subVersion).toEqual("a".charCodeAt(0));
    expect(decoder.isSupported).toEqual(false);
    expect(await decoder.getNextFrame()).toBeNull();
    await decoder.skipFrames(1000);
  });
});

suite("decode corner cases", async () => {
  test("should decode a video, reset the decoder then decode the video again", async ({
    annotate,
    expect,
  }) => {
    const decoder = await getMediaFileDecoder(mediaFiles.testfile06);
    await fetchSelectionOfFrames("testfile06", { annotate, expect }, decoder);
    decoder.reset();
    await fetchSelectionOfFrames("testfile06", { annotate, expect }, decoder);
  });
});

suite("support different usage options", async () => {
  test("should support the use of require(esm) for loading the package", async ({
    annotate,
    expect,
  }) => {
    // Load the decoder with `require()` and decode a video to verify the decoder is functioning.
    const { createBikDecoder } = require("unbikit");
    const decoder = await createBikDecoder(await mediaFiles.testfile02.getBlob());
    await fetchSelectionOfFrames("testfile02", { annotate, expect }, decoder);
  });
});
