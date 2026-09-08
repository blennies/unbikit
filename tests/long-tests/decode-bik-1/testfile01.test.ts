/**
 * Test a set of media files by decoding (most of) the frames in each and outputting screenshots of
 * a small selection of the frames.
 */

import { test } from "vitest";

import { fetchSelectionOfFrames } from "../../common.ts";

test("should decode BIK 1 frames from across the file (testfile01)", async ({
  annotate,
  expect,
}) => {
  await fetchSelectionOfFrames("testfile01", { annotate, expect });
});
