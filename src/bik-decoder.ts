/**
 * Top-level module of the BIK decoder.
 *
 * Call the static method {@link BikDecoder.open} to start decoding a BIK file. It should throw
 * an exception if the file can't be accessed or is not a valid BIK file.
 *
 * The {@link BikDecoder.isSupported} property should be checked after opening a BIK file to
 * verify that the decoder fully supports the version and sub-version of the BIK format used
 * by the file.
 *
 * @packageDocumentation
 */
import { BikAudioDecoder } from "./bik-audio-decoder.ts";
import { BikVideoDecoder, type BikVideoFrame } from "./bik-video-decoder.ts";

/**
 * Decoded header of a BIK file.
 */
interface BikHeader {
  /**
   * Version of the encoded file format.
   */
  version: 1 | 2;

  /**
   * Sub-version of the encoded file format.
   */
  subVersion: number;

  /**
   * Total size of the encoded file (in bytes).
   */
  fileSize: number;

  /**
   * Number of (video) frames stored in the file.
   *
   * Note that audio is stored with each frame but doesn't necessarily correspond to the audio
   * that should be played when the video frame is shown.
   */
  numFrames: number;

  /**
   * The total size of the largest frame (in bytes), including both audio and video that are
   * stored with that frame.
   */
  largestFrameSize: number;

  /**
   * Width of each video frame (in pixels).
   */
  width: number;

  /**
   * Height of each video frame (in pixels).
   */
  height: number;

  /**
   * Number of frames per second that the video in the file should be played at.
   */
  fps: number;

  /**
   * Flags providing additional information about the encoded file.
   */
  videoFlags: {
    /**
     * When `true`, the encoded file contains an alpha plane for each frame. Otherwise the file
     * contains no alpha information.
     */
    hasAlpha: boolean;

    /**
     * When `true`, the U and V planes in the encoded file should be swapped during the decoding
     * process.
     *
     * This is a value intended for internal use by the decoder and should not be needed by
     * applications that use the decoder.
     */
    hasSwappedUVPlanes: boolean;

    /**
     * When `true`, the encoded file doesn't contain U or V planes. Otherwise the file contains
     * both U and V planes.
     */
    isGrayscale: boolean;

    /**
     * Whether the decoded image data should be treated as scaled and/or interlaced.
     *
     * - 1 = double height
     * - 2 = double height; interlaced
     * - 3 = double width
     * - 4 = double width and height
     * - 5 = double width and height; interlaced
     *
     * Source: https://wiki.multimedia.cx/index.php/Bink_Container
     */
    scaling: number;
  };

  /**
   * Total number of audio tracks stored in the encoded file.
   *
   * Each track can have one or more channels (e.g. for stereo or surround sound).
   */
  numAudioTracks: number;

  /**
   * Array containing decoded header information for each individual audio track stored in the
   * encoded file.
   */
  audioTracks: BikAudioTrackHeader[];

  /**
   * Array containing decoded header information for each individual video frame stored in the
   * encoded file.
   */
  frames: BikFrameHeader[];
}

/**
 * Decoded header of an audio track of a BIK file.
 */
interface BikAudioTrackHeader {
  trackId: number;
  numChannels: number;
  sampleRate: number;
  flags: {
    stereo: boolean;
    useDCT: boolean;
  };
}

/**
 * Decoded header of a (video) frame of a BIK file.
 */
interface BikFrameHeader {
  /**
   * Offset of the start of the frame in the encoded file.
   */
  offset: number;

  /**
   * Total size (in bytes) of the frame in the encoded file, including both audio and video that
   * are stored with the frame.
   */
  size: number;

  /**
   * When `true`, this frame is a "key frame" that can be used as a starting point for random
   * access decoding. Should be `true` for at least the first frame of a BIK file.
   */
  keyframe: boolean;
}

/**
 * Decoded contents of a single frame of a BIK file.
 */
interface BikFrame {
  /**
   * Tracks containing audio data. Indexed by track number (_not_ track ID).
   */
  audioTracks: BikAudioTrack[];

  /**
   * Decoded video frame image data.
   */
  videoFrame: BikVideoFrame | null;
}

/**
 * Decoded contents of a single "packet" of data for an audio track in a BIK file.
 *
 * In each packet, audio samples are stored in one or more blocks, each block containing one or
 * more stereo-interleaved channels (so the number of stereo-interleaved channels in a stereo
 * audio block will be one, even though it should be played as two separate channels).
 */
interface BikAudioTrack {
  /**
   * Header associated with the audio track.
   */
  header: BikAudioTrackHeader;

  /**
   * Total size (in bytes) of the samples in the packet.
   */
  size: number;

  /**
   * Total number of samples in the packet.
   */
  numSamples: number;

  /**
   * Actual audio data for the frame (PCM, floating-point, interleaved stereo channels).
   * Indexed by block number and then by (non-stereo) channel.
   */
  blocks: Float32Array[][];
}

/**
 * Function for returning a Web Streams API readable stream for reading sequential data
 * from a BIK file.
 *
 * Currently `len` is always undefined, so the function should just return a stream for
 * accessing the rest of the file from the given start position.
 *
 * **Advance deprecation warning:** It is intended that this function will soon be replaced with
 * a more flexible and easier to use system for accessing streams.
 *
 * @experimental
 */
type GetReadStreamFn = (
  offset: number,
  len?: number | undefined, // when undefined, stream until the end of the file
) => ReadableStream<Uint8Array> | Promise<ReadableStream<Uint8Array>>;

/**
 * Main class for managing the state of a BIK decoder instance. One instance can decode a single
 * file at a time.
 */
class BikDecoder {
  #getReadStreamFn: GetReadStreamFn;

  #streamReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  #bufBytes: Uint8Array | null = null;
  #bufPos = 0;
  #curFrame = -1;

  #audioTrackDecoders: BikAudioDecoder[] = [];
  #videoDecoder: BikVideoDecoder | null = null;

  #header: BikHeader | null = null;
  #isSupported = false;

  private constructor(getReadStreamFn: GetReadStreamFn) {
    this.#getReadStreamFn = getReadStreamFn;
  }

  /**
   * Set the current file read position to the specified position, updating the read buffer and
   * potentially requesting a new readable stream if the file read position actually changes.
   * @param pos Position in the file to seek to. Specified in bytes from the start of the file.
   */
  async #seek(pos: number) {
    if (this.#bufBytes && pos === this.#bufPos) {
      return;
    }
    this.#bufPos = pos;
    this.#bufBytes = null;

    if (this.#streamReader) {
      await this.#streamReader.cancel();
      this.#streamReader.releaseLock();
      this.#streamReader = null;
    }

    const streamReader = (await this.#getReadStreamFn(pos))?.getReader();
    if (!streamReader) {
      throw new Error("Invalid stream reader");
    }
    this.#streamReader = streamReader;
  }

  /**
   * Read data from the readable stream.
   * @param len Number of bytes to read.
   * @returns The requested bytes of data. Will be at most `len` bytes, but may be fewer.
   * @throws {@link Error} Thrown if the stream ends before the requested number of bytes have
   *   been read.
   */
  async #readBytes(len: number): Promise<Uint8Array | null> {
    if (!this.#streamReader || len < 1) {
      return null;
    }

    // Ensure we have some bytes in the buffer.
    if (!this.#bufBytes) {
      const { value, done } = await this.#streamReader.read();
      if (!value || done) {
        return null;
      }
      this.#bufBytes = value;
    }

    // Try to ensure the requested number of bytes are in the buffer, otherwise return the bytes
    // that we've managed to get.
    let bufLen = this.#bufBytes.byteLength;
    while (len > bufLen) {
      const { value, done } = await this.#streamReader.read();
      if (!value || done) {
        this.#bufPos += bufLen;
        const bufBytes = this.#bufBytes;
        this.#bufBytes = null;
        return bufBytes;
      }

      const newBufLen: number = bufLen + value.byteLength;
      const newBufBytes: Uint8Array = new Uint8Array(newBufLen);
      newBufBytes.set(this.#bufBytes);
      newBufBytes.set(value, bufLen);
      this.#bufBytes = newBufBytes;
      bufLen = this.#bufBytes.byteLength;
    }

    if (bufLen === len) {
      this.#bufPos += bufLen;
      const bufBytes = this.#bufBytes;
      this.#bufBytes = null;
      return bufBytes;
    }
    this.#bufPos += len;
    const bufBytes = this.#bufBytes.subarray(0, len);
    this.#bufBytes = this.#bufBytes.subarray(len);
    return bufBytes;
  }

  /**
   * Read data from the readable stream.
   * @param len Number of bytes to read.
   * @returns The requested bytes of data.
   * @throws {@link Error} Thrown if the stream ends before the requested number of bytes have
   *   been read.
   */
  async #ensureReadBytes(len: number): Promise<Uint8Array> {
    const bufBytes = await this.#readBytes(len);
    if (bufBytes?.byteLength !== len) {
      throw new Error(`Read ${bufBytes?.byteLength ?? 0} bytes but expected ${len}`);
    }
    return bufBytes;
  }

  async #init(): Promise<void> {
    await this.#seek(0);

    // Ensure we have sufficient data to read the fixed-size header.
    const headerBytes = await this.#ensureReadBytes(44);
    const headerDataView = new DataView(headerBytes.buffer, headerBytes.byteOffset + 0, 44);
    const headerWords = new Uint32Array(11)
      .fill(0)
      .map((_, index) => headerDataView.getUint32(index << 2, true));

    // Verify the magic value (the FOURCC). If it's valid then read the expected fixed-length
    // header.
    const magicUint = headerWords[0] as number;
    const version = ([0x004b4942, 0x0032424b].indexOf(magicUint & 0x00ffffff) + 1) as 0 | 1 | 2;
    if (!version) {
      throw new Error(`Invalid format`);
    }
    const subVersion = magicUint >>> 24;
    const numFrames = headerWords[2] as number;
    const width = headerWords[5] as number;
    const height = headerWords[6] as number;
    const videoFlags = headerWords[9] as number;
    const hasAlpha = !!(videoFlags & 0x100000);
    const hasSwappedUVPlanes = subVersion > 103;
    const isGrayscale = !!(videoFlags & 0x20000);
    const scaling = (videoFlags >>> 28) & 0xf;
    const numAudioTracks = headerWords[10] as number;
    const audioTrackHeaderSize = numAudioTracks * 12;
    const frameListSize = (numFrames + 1) * 4;

    // Read audio track information.
    let audioTracks: BikAudioTrackHeader[] = [];
    if (numAudioTracks > 0) {
      const audioHeaderBytes = await this.#ensureReadBytes(audioTrackHeaderSize);
      const audioHeaderDataView = new DataView(
        audioHeaderBytes.buffer,
        audioHeaderBytes.byteOffset,
        audioTrackHeaderSize,
      );
      audioTracks = new Array(numAudioTracks).fill(null).map((_, index) => {
        const flags = audioHeaderDataView.getUint16((numAudioTracks << 2) + (index << 2) + 2, true);
        const isStereo = !!(flags & 0x2000);
        return {
          trackId: audioHeaderDataView.getUint32((numAudioTracks << 3) + (index << 2), true),
          numChannels: isStereo ? 2 : 1,
          sampleRate: audioHeaderDataView.getUint16((numAudioTracks << 2) + (index << 2), true),
          flags: {
            stereo: isStereo,
            useDCT: !!(flags & 0x1000),
          },
        };
      });
      audioTracks.forEach((audioTrack) => {
        this.#audioTrackDecoders.push(
          new BikAudioDecoder(
            audioTrack.sampleRate,
            audioTrack.numChannels,
            audioTrack.flags.useDCT,
          ),
        );
      });
    }

    // Read list of video frame offsets
    const videoHeaderBytes = await this.#ensureReadBytes(frameListSize);
    const frameListDataView = new DataView(
      videoHeaderBytes.buffer,
      videoHeaderBytes.byteOffset,
      frameListSize,
    );
    const frames: BikFrameHeader[] = new Array(numFrames).fill(null).map((_, index) => {
      const rawOffset = frameListDataView.getUint32(index << 2, true);
      const offset = rawOffset & 0xfffffffe;
      const nextOffset = frameListDataView.getUint32((index + 1) << 2, true) & 0xfffffffe;
      const size = nextOffset - offset;
      const keyframe = !!(rawOffset & 1);
      return {
        offset,
        size,
        keyframe,
      };
    });
    this.#videoDecoder = new BikVideoDecoder(
      width,
      height,
      subVersion,
      hasAlpha,
      hasSwappedUVPlanes,
    );

    // Determine whether we can decode the rest of this BIK file or not.
    this.#isSupported =
      version === 1 && subVersion > 0x63 && subVersion < 0x6a && subVersion !== 0x65;

    // Populate the full header structure.
    this.#header = {
      version,
      subVersion,
      fileSize: (headerWords[1] as number) + 8,
      numFrames,
      largestFrameSize: headerWords[3] as number,
      width,
      height,
      fps: (headerWords[7] as number) / (headerWords[8] as number),
      videoFlags: {
        hasAlpha,
        hasSwappedUVPlanes,
        isGrayscale,
        scaling,
      },
      numAudioTracks,

      audioTracks,
      frames,
    };
  }

  /**
   * Decoded header of the BIK file.
   * @returns Decoded header.
   */
  get header(): BikHeader | null {
    return this.#header;
  }

  /**
   * Whether the audio/video streams in the BIK file can be processed by the decoder or not.
   * @returns `true` when the audio/video streams can be processed by the decoder, otherwise
   *   `false`.
   */
  get isSupported(): boolean {
    return this.#isSupported;
  }

  /**
   * Get the next frame of the BIK file and decode it.
   * @param prevFrame Optional data structure for a previously decoded frame to re-use (to reduce
   *   garbage collection).
   * @returns Next decoded frame (audio and video).
   */
  async getNextFrame(prevFrame: BikFrame | null = null): Promise<BikFrame | null> {
    if (!this.#isSupported) {
      return null;
    }
    const frameHeader = this.#header?.frames[++this.#curFrame];
    if (!frameHeader) {
      this.#curFrame--;
      return null;
    }
    await this.#seek(frameHeader.offset);
    const frameBytes = await this.#ensureReadBytes(frameHeader.size);
    const frameDataView = new DataView(frameBytes.buffer, frameBytes.byteOffset, frameHeader.size);

    // Get info about audio in this frame
    const audioTracksFrame: {
      header: BikAudioTrackHeader;
      size: number;
      numSamples: number;
      bytes: Uint8Array;
    }[] = [];
    let audioFrameSize = 0;
    let audioFramePos = 0;
    for (const header of this.#header?.audioTracks ?? []) {
      const size = frameDataView.getUint32(audioFramePos, true);
      const numSamples = size > 3 ? frameDataView.getUint32(audioFramePos + 4, true) : 0;
      audioFrameSize += size;
      const bytes = frameBytes.subarray(audioFramePos + 8, audioFramePos + size + 4);
      audioTracksFrame.push({
        header,
        size,
        numSamples,
        bytes,
      });
      audioFramePos += size + 4;
    }

    // Decode the actual audio track(s) in the frame
    const audioTracks: BikAudioTrack[] = [];
    for (const [audioTrackIndex, audioTrackFrame] of audioTracksFrame.entries()) {
      const audioDecoder = this.#audioTrackDecoders[audioTrackIndex];
      if (audioDecoder) {
        const audioHeader = audioTrackFrame.header;
        audioTracks.push({
          header: audioHeader,
          size: audioTrackFrame.size,
          numSamples: audioTrackFrame.numSamples,
          blocks: audioDecoder.decode_(audioTrackFrame.bytes),
        });
      }
    }

    // Get info about video in this frame
    const videoFramePos = audioFramePos;
    const videoFrameSize = frameHeader.size - audioFrameSize;
    const videoFrameBytes = frameBytes.subarray(videoFramePos, videoFramePos + videoFrameSize);

    // Decode the actual video frame image data
    const videoFrame =
      this.#videoDecoder?.decodeFrame_(videoFrameBytes, prevFrame?.videoFrame) ?? null;

    return {
      audioTracks,
      videoFrame,
    };
  }

  /**
   * Skip the specified number of frames of the BIK file. They will still be decoded as decoding
   * a frame can effectively require data from any number of earlier frames.
   * @param numFrames Number of frames to skip, but still decode.
   */
  async skipFrames(numFrames: number): Promise<void> {
    let frame: BikFrame | null = null;
    for (let i = 0; i < numFrames; i++) {
      frame = await this.getNextFrame(frame);
      if (!frame) {
        return;
      }
    }
  }

  /**
   * Reset the current frame index so the decoder is ready to start decoding the BIK file from the
   * beginning. Note that this will result in the decoder requesting a new readable stream.
   */
  reset(): void {
    this.#curFrame = -1;
  }

  /**
   * Attempt to read and parse the headers of a BIK file. If successful, return an instance of
   * {@link BikDecoder} for decoding the rest of the file.
   * @param getReadStreamFn -
   *   Function that returns a stream for linear access to part of the file.
   * @returns Decoder instance. Use {@link header} to access the parsed headers.
   */
  static async open(getReadStreamFn: GetReadStreamFn): Promise<BikDecoder> {
    const decoder = new BikDecoder(getReadStreamFn);
    await decoder.#init();
    return decoder;
  }
}

export { BikDecoder };
export type {
  BikAudioTrack,
  BikAudioTrackHeader,
  BikFrame,
  BikFrameHeader,
  BikHeader,
  BikVideoFrame,
  GetReadStreamFn,
};
