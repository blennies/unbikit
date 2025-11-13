import { objectEntries } from "ts-extras";
import { describe } from "vitest";
import { BikDecoder } from "../src/bik-decoder.ts";
import { frameToPng, getShaSum, it, mediaFiles } from "./common.ts";

describe.each(
  objectEntries(mediaFiles).map(([name, file]) => ({
    name,
    file,
  })),
)(
  "decoding of media file $name",
  async ({ name, file }) => {
    const decoder = await BikDecoder.open(file.getStreamFn());
    const header = decoder?.header;
    const numFrames = Math.min((header?.numFrames ?? 1) - 1, 500);
    const frameQuarters = ~~(numFrames / 4);

    it(`should decode the header (${name})`, async ({ annotate, expect }) => {
      expect(header).toBeTruthy();
      annotate(
        `header info for ${name} -- version: ${header?.version}${String.fromCharCode(header?.subVersion ?? 63)}, frames: ${header?.numFrames}, image size: ${header?.width}x${header?.height}`,
      );
    });

    it(`should decode frames from across the file (${name})`, async ({ annotate, expect }) => {
      let frameNum = 0;
      while (frameNum <= frameQuarters * 4) {
        const frame = await decoder.getNextFrame();
        expect(frame?.audioTracks).toBeDefined();
        expect(frame?.videoFrame).toBeDefined();

        const frameName = `screenshot_${name}_frame_${frameNum}.png`;
        const png = frameToPng(frame);
        expect(await getShaSum(png)).toMatchSnapshot(frameName);
        annotate(frameName, {
          body: png,
          contentType: "image/png",
        });
        await decoder.skipFrames(frameQuarters - 1);
        frameNum += frameQuarters;
      }
    });
  },
  10000,
);
