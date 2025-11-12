# Changelog

## 0.1.0 (2025-11-12)

### Features

- Add initial implementation of the `.bik` video decoder ([124c3b9](https://github.com/blennies/unbikit/commit/124c3b952e8944ace6beb7f8d0e34ee7a77bae93)).

  Consists of a stream reader, header parser, demuxer, and audio/video decoders. Version 1 of the
  `.bik` video format is supported, except for revision `b`. DCT and DFT compressed audio are both
  supported. Each outputted frame combines a single video frame with a chunk of decoded audio.
