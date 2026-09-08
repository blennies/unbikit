/**
 * Test a set of media files by decoding (most of) the frames in each and outputting screenshots of
 * a small selection of the frames.
 */

import { test } from "vitest";

import { fetchSelectionOfFrames } from "../../common.ts";

test("should decode BIK 1 frames from across the file (testfile04)", async ({
  annotate,
  expect,
}) => {
  await fetchSelectionOfFrames("testfile04", { annotate, expect });
});
