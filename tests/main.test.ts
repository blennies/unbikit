/**
 * Test a set of media files by decoding (most of) the frames in each and outputting screenshots
 * of a small selection of the frames.
 *
 * Test valid BIK 1 files that should be decoded correctly, along with valid BIK 1b and 2 files
 * that the decoder should refuse to decode but handle gracefully.
 */
import { suite, type TestContext, test } from "vitest";
import { frameToPng, getMediaFileDecoder, getShaSum, mediaFiles } from "./common.ts";

const fetchSelectionOfFrames = async (
  fileIndex: keyof typeof mediaFiles,
  { annotate, expect }: Pick<TestContext, "annotate" | "expect">,
): Promise<void> => {
  const file = mediaFiles[fileIndex];
  const decoder = await getMediaFileDecoder(mediaFiles[fileIndex]);
  const header = decoder?.header;
  const numFrames = Math.min((header?.numFrames ?? 1) - 1, 500);
  const frameQuarters = ~~(numFrames / 4);
  expect(header).toBeTruthy();
  annotate(
    `header info for ${file.name} -- version: ${header?.version}${String.fromCharCode(header?.subVersion ?? 63)}, frames: ${header?.numFrames}, image size: ${header?.width}x${header?.height}, flags: ${JSON.stringify(header?.videoFlags)}`,
  );

  let frameNum = 0;
  while (frameNum <= frameQuarters * 4) {
    const frame = await decoder.getNextFrame();
    expect(frame?.audioTracks).toBeDefined();
    expect(frame?.videoFrame).toBeDefined();

    const frameName = `screenshot_${file.name}_frame_${frameNum}.png`;
    const png = frameToPng(frame);
    annotate(frameName, {
      body: png,
      contentType: "image/png",
    });
    expect(await getShaSum(png)).toMatchSnapshot(frameName);
    await decoder.skipFrames(frameQuarters - 1);
    frameNum += frameQuarters;
  }
};

suite("decode BIK 1 (d, f, g, h, i) media files", async () => {
  test("should decode frames from across the file (testfile01)", async ({ annotate, expect }) => {
    await fetchSelectionOfFrames("testfile01", { annotate, expect });
  });
  test("should decode frames from across the file (testfile02)", async ({ annotate, expect }) => {
    await fetchSelectionOfFrames("testfile02", { annotate, expect });
  });
  test("should decode frames from across the file (testfile03)", async ({ annotate, expect }) => {
    await fetchSelectionOfFrames("testfile03", { annotate, expect });
  });
  test("should decode frames from across the file (testfile04)", async ({ annotate, expect }) => {
    await fetchSelectionOfFrames("testfile04", { annotate, expect });
  });
  test("should decode frames from across the file (testfile05)", async ({ annotate, expect }) => {
    await fetchSelectionOfFrames("testfile05", { annotate, expect });
  });
  test("should decode frames from across the file (testfile06)", async ({ annotate, expect }) => {
    await fetchSelectionOfFrames("testfile06", { annotate, expect });
  });
  test("should decode frames from across the file (testfile07; interlaced)", async ({
    annotate,
    expect,
  }) => {
    await fetchSelectionOfFrames("testfile07", { annotate, expect });
  });
});

suite("decode media files of unsupported BIK versions", async () => {
  test("should decode header but refuse to decode BIK 1b (testfile08bk1b)", async ({
    annotate,
    expect,
  }) => {
    const decoder = await getMediaFileDecoder(mediaFiles.testfile08bk1b);
    const header = decoder.header;
    annotate(
      `header info -- version: ${header?.version}${String.fromCharCode(header?.subVersion ?? 63)}, frames: ${header?.numFrames}, image size: ${header?.width}x${header?.height}`,
    );
    expect(header?.version).toEqual(1);
    expect(header?.subVersion).toEqual("b".charCodeAt(0));
    expect(decoder.isSupported).toEqual(false);
    expect(await decoder.getNextFrame()).toBeNull();
    await decoder.skipFrames(1000);
  });

  test("should decode header but refuse to decode BIK 2a (testfile09bk2)", async ({
    annotate,
    expect,
  }) => {
    const decoder = await getMediaFileDecoder(mediaFiles.testfile09bk2);
    const header = decoder.header;
    annotate(
      `header info -- version: ${header?.version}${String.fromCharCode(header?.subVersion ?? 63)}, frames: ${header?.numFrames}, image size: ${header?.width}x${header?.height}`,
    );
    expect(header?.version).toEqual(2);
    expect(header?.subVersion).toEqual("a".charCodeAt(0));
    expect(decoder.isSupported).toEqual(false);
    expect(await decoder.getNextFrame()).toBeNull();
    await decoder.skipFrames(1000);
  });
});
