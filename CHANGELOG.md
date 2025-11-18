# Changelog

## [0.4.0](https://github.com/blennies/unbikit/compare/v0.3.0...v0.4.0) (2025-11-18)

### Features

- Add demo with an example video player and documentation
  (by [@blennies](https://github.com/blennies) in
  [#26](https://github.com/blennies/unbikit/pull/26),
  [e747e37](https://github.com/blennies/unbikit/commit/e747e374df125b27d1e6ecd7cf06fa45643bb2ad))

  The demo consists of a website with library documentation and an example video player for .bik
  files. A pre-defined list of streamable videos is provided, or alternatively a video can be
  uploaded to the browser.

- Add support for CSS view transitions
  (by [@blennies](https://github.com/blennies) in
  [#26](https://github.com/blennies/unbikit/pull/26),
  [e747e37](https://github.com/blennies/unbikit/commit/e747e374df125b27d1e6ecd7cf06fa45643bb2ad))

### Performance

- Optimize build settings to reduce the minified size of the decoder
  (by [@blennies](https://github.com/blennies) in
  [#26](https://github.com/blennies/unbikit/pull/26),
  [e747e37](https://github.com/blennies/unbikit/commit/e747e374df125b27d1e6ecd7cf06fa45643bb2ad))

## [0.3.0](https://github.com/blennies/unbikit/compare/v0.2.0...v0.3.0) (2025-11-14)

### Features

- Handle unsupported BIK versions and indicate status via the `isSupported` property
  ([818ae04](https://github.com/blennies/unbikit/commit/818ae04eabf7ce46c08df361f6b19404f80c70c8))

## [0.2.0](https://github.com/blennies/unbikit/compare/unbikit-v0.1.0...unbikit-v0.2.0) (2025-11-13)

### Features

- Add `skipFrames()` method for skipping multiple decoded frames
  ([6d564dd](https://github.com/blennies/unbikit/commit/6d564dd873da1c95e5cbfb4bdb1ec16d865dcf73))

Regression testing has also been improved significantly.

## 0.1.0 (2025-11-12)

### Features

- Add initial implementation of the `.bik` video decoder
  ([124c3b9](https://github.com/blennies/unbikit/commit/124c3b952e8944ace6beb7f8d0e34ee7a77bae93))

  Consists of a stream reader, header parser, demuxer, and audio/video decoders. Version 1 of the
  `.bik` video format is supported, except for revision `b`. DCT and DFT compressed audio are both
  supported. Each outputted frame combines a single video frame with a chunk of decoded audio.
