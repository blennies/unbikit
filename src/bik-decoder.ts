/**
 * Top-level module of the BIK decoder.
 *
 * Call the function {@link createBikDecoder} to start decoding a BIK video from a data source.
 * The decoder should throw an exception if the data source can't be accessed or is not a valid
 * video data source.
 *
 * The {@link BikDecoder.isSupported} property should be checked after creating a decoder to
 * verify that the decoder fully supports the version and sub-version of the BIK format used
 * by the video.
 *
 * If {@link BikDecoder.isSupported} is `true` then {@link BikDecoder.getNextFrame} can be called
 * repeatedly to get each consecutive frame of the video from the data source. Audio data may
 * also be supplied with each frame.
 *
 * Local files and {@link ArrayBuffer}s can be supplied as data sources in the form of
 * {@link File} and {@link Blob} respectively. Remote files can be accessed either by supplying
 * either a {@link URL} or a {@link Request} instance that refers to the remote file. The
 * latter can be used to get more control over the requests that are sent to fetch the file from
 * the data source (such as setting header fields). Note that the decoder may modify the
 * {@link Request} instance.
 *
 * The [Fetch API](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API)
 * is used to fetch video data from a remote source.
 *
 * @packageDocumentation
 */

import { BikAudioDecoder } from "./bik-audio-decoder.ts";
import { BikVideoDecoder, type BikVideoFrame } from "./bik-video-decoder.ts";

/**
 * Decoded header of a BIK data source.
 */
interface BikHeader {
  /**
   * Version of the encoding format.
   */
  version: 1 | 2;

  /**
   * Sub-version of the encoding format.
   */
  subVersion: number;

  /**
   * Total size of the encoded video data (in bytes).
   */
  totalSize: number;

  /**
   * Number of frames in the video.
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
   * Number of frames per second that the video should be played at.
   */
  fps: number;

  /**
   * Flags providing additional information about the encoded video.
   */
  videoFlags: {
    /**
     * When `true`, the encoded video contains an alpha plane for each frame. Otherwise the video
     * contains no alpha information.
     */
    hasAlpha: boolean;

    /**
     * When `true`, the U and V planes in the encoded video should be swapped during the decoding
     * process.
     *
     * This is a value intended for internal use by the decoder and should not be needed by
     * applications that use the decoder.
     */
    hasSwappedUVPlanes: boolean;

    /**
     * When `true`, the encoded video doesn't contain U or V planes. Otherwise the video contains
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
   * Total number of audio tracks stored in the encoded video.
   *
   * Each track can have one or more channels (e.g. for stereo or surround sound).
   */
  numAudioTracks: number;

  /**
   * Array containing decoded header information for each individual audio track stored in the
   * encoded video.
   */
  audioTracks: BikAudioTrackHeader[];

  /**
   * Array containing decoded header information for each individual video frame stored in the
   * encoded video.
   */
  frames: BikFrameHeader[];
}

/**
 * Decoded header of an audio track of a BIK video.
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
 * Decoded header of a frame of a BIK video.
 */
interface BikFrameHeader {
  /**
   * Offset of the start of the frame in the encoded video.
   */
  offset: number;

  /**
   * Total size (in bytes) of the frame in the encoded video, including both audio and video that
   * are stored with the frame.
   */
  size: number;

  /**
   * When `true`, this frame is a "key frame" that can be used as a starting point for random
   * access decoding. Must be `true` for the first frame.
   */
  keyframe: boolean;
}

/**
 * Decoded contents of a single frame of a BIK video.
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
 * Decoded contents of a single "packet" of data for an audio track in a BIK video.
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
 * Main class for managing the state of a BIK decoder instance. One instance can decode a single
 * video from a single data source at a time.
 */
class BikDecoder {
  /**
   * Source of the video.
   */
  #dataSource: Blob | File | URL | Request;

  /**
   * Optional slice of {@link #dataSource}. Used by {@link Blob} and {@link File} sources so
   * the original {@link Blob}/{@link File} is preserved after a {@link #seek}.
   */
  #curDataSource: Blob | File | null = null;

  /**
   * A {@link ReadableStreamDefaultReader} for the current position in the encoded video data.
   */
  #streamReader: ReadableStreamDefaultReader<Uint8Array> | null = null;

  /**
   * Buffer of encoded video data being processed by the decoder.
   */
  #bufBytes: Uint8Array | null = null;

  /**
   * Start of the {@link #bufBytes} buffer relative to the start of the encoded video data.
   */
  #bufPos = 0;

  #curFrame = -1;

  #audioTrackDecoders: BikAudioDecoder[] = [];
  #videoDecoder: BikVideoDecoder | null = null;

  #header: BikHeader | null = null;
  #isSupported = false;

  private constructor(source: Blob | File | URL | Request) {
    this.#dataSource = source;
  }

  /**
   * Set the current video data read position to the specified position, updating the read
   * buffer and potentially creating a new readable stream if the read position actually
   * changes.
   * @param pos Position in the video to seek to. Specified in bytes from the start of the
   *   video.
   */
  async #seek(pos: number): Promise<void> {
    if (pos < 0) {
      return;
    }

    if (this.#bufBytes) {
      // If there's data in the buffer and the current position of the start of the buffer
      // matches the requested position in the video data then there's nothing to do.
      if (pos === this.#bufPos) {
        return;
      }

      // If the requested position in the video data is in the buffer already then advance the
      // buffer to that position and return.
      if (pos > this.#bufPos && pos < this.#bufPos + this.#bufBytes.byteLength) {
        this.#bufBytes = this.#bufBytes.subarray(pos - this.#bufPos);
        this.#bufPos = pos;
        return;
      }
    }

    // The above checks failed so we need a new readable stream for the requested position in the
    // video data.

    if (this.#streamReader) {
      await this.#streamReader.cancel();
      this.#streamReader.releaseLock();
      this.#streamReader = null;
    }

    let streamReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    if (this.#dataSource instanceof Blob) {
      // `File` is a superset of `Blob`, so here we handle both.
      if (!this.#curDataSource) {
        this.#curDataSource = this.#dataSource;
      }
      streamReader = this.#curDataSource.slice(pos).stream()?.getReader();
    } else if (this.#dataSource instanceof URL || this.#dataSource instanceof Request) {
      console.log();
      const request: Request =
        this.#dataSource instanceof Request ? this.#dataSource : new Request(this.#dataSource);
      const headers = request.headers;
      headers.delete("range");
      if (pos) {
        headers.set("range", `bytes=${pos}-`);
      }
      streamReader = (await fetch(request))?.body?.getReader();
    }

    if (!streamReader) {
      throw new Error("Invalid stream reader");
    }
    this.#streamReader = streamReader;
    this.#bufPos = pos;
    this.#bufBytes = null;
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

  /**
   * Initialize the decoder by parsing the header from the readable stream to get the required
   * information about the encoded video, including the offsets of all the frames.
   */
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

    // Read audio track information and create an audio decoder for each track.
    let audioTracks: BikAudioTrackHeader[] = [];
    if (numAudioTracks > 0) {
      const audioHeaderBytes = await this.#ensureReadBytes(audioTrackHeaderSize);
      const audioHeaderDataView = new DataView(
        audioHeaderBytes.buffer,
        audioHeaderBytes.byteOffset,
        audioTrackHeaderSize,
      );
      audioTracks = new Array(numAudioTracks).fill(null).map((_, index) => {
        const flags = audioHeaderDataView.getUint16(
          (numAudioTracks << 2) + (index << 2) + 2,
          true,
        );
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

    // Read list of video frame offsets.
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

    // Create an image ("video") decoder for decoding the image data in each consecutive frame.
    this.#videoDecoder = new BikVideoDecoder(
      width,
      height,
      subVersion,
      hasAlpha,
      hasSwappedUVPlanes,
    );

    // Determine whether we can decode the rest of this BIK data source or not.
    this.#isSupported =
      version === 1 && subVersion > 0x63 && subVersion < 0x6a && subVersion !== 0x65;

    // Populate the full header structure.
    this.#header = {
      version,
      subVersion,
      totalSize: (headerWords[1] as number) + 8,
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
   * Decoded header of the BIK data source.
   * @returns Decoded header.
   */
  get header(): BikHeader | null {
    return this.#header;
  }

  /**
   * Whether the audio/video streams in the BIK data source can be processed by the decoder or
   * not.
   * @returns `true` when the audio/video streams can be processed by the decoder, otherwise
   *   `false`.
   */
  get isSupported(): boolean {
    return this.#isSupported;
  }

  /**
   * Get the next frame of the BIK data source and decode it.
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
   * Skip the specified number of frames of the BIK data source. They will still be decoded
   * as decoding a frame can effectively require data from any number of earlier frames.
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
   * Reset the current frame index so the decoder is ready to start decoding the BIK data source
   * from the beginning. Note that this will result in the decoder requesting a new readable
   * stream.
   */
  reset(): void {
    this.#curFrame = -1;
  }

  /**
   * Attempt to read and parse the headers of a BIK video. If successful, return an instance of
   * {@link BikDecoder} for decoding the rest of the video from the data source.
   * @param source Data source that will provide the encoded video data.
   * @returns Decoder instance. Use {@link BikDecoder.header} to access the parsed headers.
   */
  static async open(source: Blob | File | URL | Request): Promise<BikDecoder> {
    const decoder = new BikDecoder(source);
    await decoder.#init();
    return decoder;
  }
}

/**
 * Attempt to read and parse the headers of a BIK video. If successful, return an instance of
 * {@link BikDecoder} for decoding the rest of the video from the data source.
 * @param source Data source that will provide the encoded video data.
 * @returns Decoder instance. Use {@link BikDecoder.header} to access the parsed headers.
 */
const createBikDecoder: (source: Blob | File | URL | Request) => Promise<BikDecoder> =
  BikDecoder.open;

export { createBikDecoder };
export type {
  BikAudioTrack,
  BikAudioTrackHeader,
  BikDecoder,
  BikFrame,
  BikFrameHeader,
  BikHeader,
  BikVideoFrame,
};
