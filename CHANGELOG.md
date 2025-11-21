# Changelog

## [0.6.2](https://github.com/blennies/unbikit/compare/v0.6.1...v0.6.2) (2025-11-21)


### Bug Fixes

* **docs:** Replace badges that won't display on npm or GitHub ([#42](https://github.com/blennies/unbikit/issues/42)) ([92d522a](https://github.com/blennies/unbikit/commit/92d522aafe70e19d1107b79735ccde7ee395af08))

## [0.6.1](https://github.com/blennies/unbikit/compare/v0.6.0...v0.6.1) (2025-11-21)

### Performance Improvements

- Optimize IDCT and IRDFT implementations of the video and audio decoders
  ([#39](https://github.com/blennies/unbikit/issues/39))
  ([82cccdc](https://github.com/blennies/unbikit/commit/82cccdcd7588303341728cd5bb55f1a79234441b))

  The video decoder uses a 2D DCT-III (inverse of DCT-II, sometimes just called IDCT)
  implementation, and the audio decoder uses either a 1D Inverse Real Discrete Fourier
  Transform (IRDFT) or a 1D Inverse Discrete Cosine Transform (IDCT). More sine and cosine
  lookup tables have been added to the audio decoder, and various code optimizations have
  been made to the 2D IDCT of the video decoder.

  FPS improvements of up to 20% have been observed with complex videos that make heavy use of
  the IDCT/IRDFT algorithms.

## [0.6.0](https://github.com/blennies/unbikit/compare/v0.5.0...v0.6.0) (2025-11-20)

### Performance Improvements

- Optimize block copy operations in videos
  ([#35](https://github.com/blennies/unbikit/issues/35))
  ([5b531b7](https://github.com/blennies/unbikit/commit/5b531b7397d8fac5541568d0ab22e884602f43f8))

  This change gives a **_major_** increase to decoding speed for most videos. FPS (frames per second)
  improvements of between 20% and 1,200% can be seen in the benchmarks ("hz" represents the median FPS):

  ```sh
  > unbikit@0.6.0 bench
  > vitest bench --run

  RUN  v4.0.10

  ✓ tests/main.bench.ts > benchmark 72906ms
      name                                    hz     min      max    mean     p75     p99    p995    p999     rme  samples
    · decode of a frame of testfile01     755.62  0.0723  10.1624  1.5887  1.7413  3.4561  3.7919  4.8968  ±0.64%    10000
    · decode of a frame of testfile02  25,939.23  0.0252   4.4826  0.3243  0.0380  2.2814  2.8931  3.8021  ±4.02%    10000
    · decode of a frame of testfile03  48,525.00  0.0104   3.5536  0.1862  0.3992  0.7494  1.6234  2.3394  ±2.69%    10000
    · decode of a frame of testfile04   2,185.17  0.0303   6.8059  1.5158  2.1640  4.4432  5.2130  6.0582  ±1.31%    10000
    · decode of a frame of testfile05   3,699.67  0.0450   7.6835  0.8676  1.4391  2.4982  3.2387  5.8404  ±1.70%    10000
    · decode of a frame of testfile06   4,129.25  0.0291   4.2722  0.9196  1.3440  3.0265  3.1956  3.4895  ±1.48%    10000
    · decode of a frame of testfile07   2,488.67  0.0118   7.5235  1.7021  2.1133  4.0822  4.3607  6.4656  ±0.94%    10000


  > unbikit@0.5.0 bench
  > vitest bench --run

  RUN  v4.0.10

  ✓ tests/main.bench.ts > benchmark 85055ms
      name                                   hz     min      max    mean     p75     p99    p995     p999     rme  samples
    · decode of a frame of testfile01    624.68  0.3201   161.58  1.7983  1.9422  3.5596  4.0219   4.9948  ±1.83%    10000
    · decode of a frame of testfile02  4,741.15  0.1519   9.0390  0.4753  0.2243  2.4211  3.9970   7.0758  ±3.05%    10000
    · decode of a frame of testfile03  3,818.20  0.1803   6.9488  0.3642  0.5529  0.8825  2.4169   3.7548  ±1.69%    10000
    · decode of a frame of testfile04    711.86  0.4686  45.0704  1.8906  2.4002  4.5546  5.2643   6.7018  ±1.53%    10000
    · decode of a frame of testfile05    709.65  0.7739  14.8372  1.6529  2.1308  3.1394  4.3492  12.5871  ±1.07%    10000
    · decode of a frame of testfile06    916.90  0.5484  11.1577  1.3421  1.6770  3.1628  3.4305  10.7946  ±1.14%    10000
    · decode of a frame of testfile07  1,504.80  0.1389  26.1466  0.7944  0.8737  1.4899  2.6282   3.3601  ±1.62%    10000
  ```

- Remove redundant operations from decoder `reset()` method
  ([5b531b7](https://github.com/blennies/unbikit/commit/5b531b7397d8fac5541568d0ab22e884602f43f8))

  **BREAKING CHANGE:** API change for `reset()` method.

### Bundle Size Reductions

- Change method names and some other small changes
  ([5b531b7](https://github.com/blennies/unbikit/commit/5b531b7397d8fac5541568d0ab22e884602f43f8))

## [0.5.0](https://github.com/blennies/unbikit/compare/v0.4.0...v0.5.0) (2025-11-19)

### Features

- Add support for decoding interlaced videos
  ([#33](https://github.com/blennies/unbikit/issues/33))
  ([5aa71a1](https://github.com/blennies/unbikit/commit/5aa71a1fb82811655097648dacb4c07ae65e5934))
- Add video flags for scaling and grayscale to the decoder's header data
  ([5aa71a1](https://github.com/blennies/unbikit/commit/5aa71a1fb82811655097648dacb4c07ae65e5934))

### Bundle Size Reductions

- Reduce lengths of error messages
  ([5aa71a1](https://github.com/blennies/unbikit/commit/5aa71a1fb82811655097648dacb4c07ae65e5934))
- Replace internal runtime checks with type checks where possible
  ([5aa71a1](https://github.com/blennies/unbikit/commit/5aa71a1fb82811655097648dacb4c07ae65e5934))

### Robustness

- Limit number of audio channels to a reasonable value (8) to guard against corrupted files
  ([5aa71a1](https://github.com/blennies/unbikit/commit/5aa71a1fb82811655097648dacb4c07ae65e5934))

## [0.4.0](https://github.com/blennies/unbikit/compare/v0.3.0...v0.4.0) (2025-11-18)

### Features

- Add demo with an example video player and documentation
  ([e747e37](https://github.com/blennies/unbikit/commit/e747e374df125b27d1e6ecd7cf06fa45643bb2ad)),
  closes [#26](https://github.com/blennies/unbikit/issues/26)
- Add support for CSS view transitions
  ([e747e37](https://github.com/blennies/unbikit/commit/e747e374df125b27d1e6ecd7cf06fa45643bb2ad))

### Bundle Size Reductions

- Optimize build settings to reduce the minified size of the decoder
  ([e747e37](https://github.com/blennies/unbikit/commit/e747e374df125b27d1e6ecd7cf06fa45643bb2ad))

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
