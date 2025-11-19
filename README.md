# unbikit

[![npm package minimized gzipped size](https://img.shields.io/bundlejs/size/unbikit)](https://bundlejs.com/?q=unbikit)

> ⚠️
> This package is at a very early development stage. Expect **_major_** API changes!

unbikit (_un-bik-ɪt_) is a decoder for `.bik` video files that can be used to play or
transcode videos using the Web Streams API.

⭐ [Documentation](https://blennies.github.io/unbikit/) and a
⭐ [video player demo](https://blennies.github.io/unbikit/demo/)
are available, as well as a
[repository page on GitHub](https://github.com/blennies/unbikit)!

### Features

- Supports Bink 1, revisions `c` to `i` inclusive
- Handles demuxing and decompression of audio and video streams
- TypeScript/JavaScript only (no WASM or native code)
- No dependencies
- Uses Web Streams API for efficient reading of video files
- Isomorphic
  - runs on client/server runtimes that support at least ES2022
  - can be run with older runtimes by using the syntax lowering feature of some bundlers

## License

This software is distributed under Apache License (Version 2.0) or MIT License
terms, at your option.

See [LICENSE](./LICENSE.md) for details.

**SPDX-License-Identifier: MIT OR Apache-2.0**

## Bink Video Licensing

The `.bik` file format is a proprietary format used by
[Bink Video](https://www.radgametools.com/bnkmain.htm), developed by
[Epic Games Tools](https://www.radgametools.com/) (formerly RAD Game Tools).
The redistribution of Bink Video files may require an additional license from
Epic Games Tools. More information can be found in their
[Bink FAQ](https://www.radgametools.com/binkfaq.htm).
